import { Router } from 'express';
import { z } from 'zod';
import { Book, BookTransaction, Fine, Income, Student } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { plain } from '../db/mongo/query.js';
import { asyncHandler, ok, created } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import { isAdmin, accessibleStudentIds, isStudent, isParent, studentIdOf } from '../lib/scope.js';
import { notify } from '../lib/notify.js';

const router = Router();

const FINE_PER_DAY = 2;

router.use(
  '/books',
  createResourceRouter({
    table: 'books',
    module: 'library',
    entityType: 'Book',
    counts: {
      // How many copies are out, not how many exist.
      issued_count: { from: 'book_transactions', on: 'book_id', where: { status: 'ISSUED' } },
    },
    searchable: ['title', 'author', 'isbn', 'publisher', 'category'],
    filterable: ['category', 'status', 'language'],
    sortable: ['id', 'title', 'author', 'available_copies'],
    required: ['title'],
    defaultSort: 'title',
    beforeCreate: (data) => ({ ...data, available_copies: data.available_copies ?? data.total_copies ?? 1 }),
  })
);

const transactionsRouter = createResourceRouter({
  table: 'book_transactions',
  module: 'library',
  entityType: 'Book Transaction',
  populate: {
    book_id: { title: 'book_title', author: 'author', isbn: 'isbn' },
    student_id: { first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number' },
    'student_id.class_id': { name: 'class_name' },
    'faculty_id.user_id': { full_name: 'faculty_name' },
    issued_by: { full_name: 'issued_by_name' },
  },
  /** What the CASE expression worked out: a loan still out, past its date. */
  derive: (row) => ({
    is_overdue: row.status === 'ISSUED'
      && row.due_date
      && String(row.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10)
      ? 1 : 0,
  }),
  searchable: [],
  filterable: ['book_id', 'student_id', 'faculty_id', 'status', 'member_type'],
  sortable: ['id', 'issue_date', 'due_date'],
  defaultSort: 'issue_date',
  readOnly: true,
  scopeFilter: async (req) => {
    // Students see only their own borrowing history.
    if (!isStudent(req.user) && !isParent(req.user)) return null;
    const allowed = await accessibleStudentIds(req.user);
    if (!allowed?.length) return { $expr: { $eq: [1, 0] } };
    return { student_id: { $in: allowed.map(oid).filter(Boolean) } };
  },
});

/** Issue a book. */
transactionsRouter.post(
  '/issue',
  requirePermission('library.create'),
  validateBody(
    z.object({
      book_id: z.coerce.number().int().positive(),
      member_type: z.enum(['STUDENT', 'FACULTY']).default('STUDENT'),
      student_id: z.coerce.number().int().positive().optional().nullable(),
      faculty_id: z.coerce.number().int().positive().optional().nullable(),
      days: z.coerce.number().int().min(1).max(90).default(14),
      remarks: z.string().max(200).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const book = plain(await Book.findById(oid(body.book_id)));
    if (!book) throw notFound('Book not found');
    if (book.available_copies < 1) throw badRequest('No copies of this title are available');
    if (body.member_type === 'STUDENT' && !body.student_id) throw badRequest('Select a student');
    if (body.member_type === 'FACULTY' && !body.faculty_id) throw badRequest('Select a faculty member');

    const dueDate = new Date(Date.now() + body.days * 86400000).toISOString().slice(0, 10);

    const transactionId = await transaction(async (session) => {
      const opts = session ? { session } : {};
      const [loan] = await BookTransaction.create([{
        campus_id: oid(book.campus_id),
        book_id: oid(book.id),
        member_type: body.member_type,
        student_id: body.member_type === 'STUDENT' ? oid(body.student_id) : null,
        faculty_id: body.member_type === 'FACULTY' ? oid(body.faculty_id) : null,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: dueDate,
        status: 'ISSUED',
        issued_by: oid(req.user.id),
        remarks: body.remarks,
      }], opts);

      /*
       * Decremented by the database rather than written from a number read
       * earlier. Two librarians issuing the last two copies at once would both
       * have read the same count and both write the same result, leaving the
       * shelf one book short of what the system believes. `$inc` cannot do
       * that, and the guard keeps it from going below zero.
       */
      await Book.updateOne(
        { _id: oid(book.id), available_copies: { $gt: 0 } },
        { $inc: { available_copies: -1 } },
        opts
      );
      return String(loan._id);
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'library',
      entityType: 'Book Transaction',
      entityId: transactionId,
      description: `Issued "${book.title}" (due ${dueDate})`,
    });
    return created(res, plain(await BookTransaction.findById(oid(transactionId))));
  })
);

/** Return a book, raising a fine when it is late. */
transactionsRouter.post(
  '/:id/return',
  requirePermission('library.edit'),
  validateBody(z.object({ condition: z.enum(['GOOD', 'DAMAGED', 'LOST']).default('GOOD'), remarks: z.string().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const record = plain(await BookTransaction.findById(oid(id)));
    if (!record) throw notFound('Transaction not found');
    if (record.status === 'RETURNED') throw badRequest('This book has already been returned');

    const today = new Date().toISOString().slice(0, 10);
    const overdueDays = Math.max(0, Math.floor((new Date(today) - new Date(record.due_date)) / 86400000));

    const result = await transaction(async (session) => {
      const opts = session ? { session } : {};

      await BookTransaction.updateOne({ _id: oid(id) }, {
        $set: {
          return_date: today,
          status: req.body.condition === 'LOST' ? 'LOST' : 'RETURNED',
          remarks: req.body.remarks,
        },
      }, opts);

      const book = plain(await Book.findById(oid(record.book_id)));

      if (req.body.condition !== 'LOST') {
        /*
         * A copy comes back to the shelf, but never more than the library owns
         * — the Math.min guarded against a double return inflating the count.
         * Incrementing only while below the total says the same thing, and
         * says it in the write rather than in a number read beforehand.
         */
        await Book.updateOne(
          { _id: oid(record.book_id), $expr: { $lt: ['$available_copies', '$total_copies'] } },
          { $inc: { available_copies: 1 } },
          opts
        );
      }

      let fineId = null;
      let fineAmount = 0;
      if (overdueDays > 0 || req.body.condition !== 'GOOD') {
        fineAmount =
          req.body.condition === 'LOST'
            ? Number(book?.price || 0) || 500
            : overdueDays * FINE_PER_DAY + (req.body.condition === 'DAMAGED' ? 100 : 0);
        if (fineAmount > 0) {
          const [fine] = await Fine.create([{
            campus_id: oid(record.campus_id),
            book_transaction_id: oid(id),
            student_id: oid(record.student_id),
            faculty_id: oid(record.faculty_id),
            fine_type: req.body.condition === 'GOOD' ? 'LATE_RETURN' : req.body.condition,
            amount: fineAmount,
            reason:
              req.body.condition === 'GOOD'
                ? `${overdueDays} day(s) overdue`
                : `Book returned ${req.body.condition.toLowerCase()}`,
          }], opts);
          fineId = String(fine._id);
        }
      }
      return { fineId, fineAmount };
    });

    if (result.fineAmount > 0 && record.student_id) {
      const student = await Student.findById(oid(record.student_id)).select('user_id').lean();
      if (student?.user_id) {
        await notify({
          userId: student.user_id,
          campusId: record.campus_id,
          type: 'LIBRARY_FINE',
          title: 'Library fine raised',
          body: `A fine of ${result.fineAmount} has been recorded against your account.`,
          // No library page in the family section, so no link to a dead route.
          link: null,
        });
      }
    }

    await logActivity({
      req,
      action: 'UPDATE',
      module: 'library',
      entityType: 'Book Transaction',
      entityId: id,
      description: `Returned book (transaction #${id})${result.fineAmount ? ` with a fine of ${result.fineAmount}` : ''}`,
    });
    return ok(res, { id, returned: true, ...result, overdueDays });
  })
);
router.use('/transactions', transactionsRouter);

const finesRouter = createResourceRouter({
  table: 'fines',
  module: 'library',
  entityType: 'Fine',
  populate: {
    student_id: { first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number' },
    // The book is reached through the loan the fine is against.
    'book_transaction_id.book_id': { title: 'book_title' },
    collected_by: { full_name: 'collected_by_name' },
  },
  searchable: [],
  filterable: ['student_id', 'faculty_id', 'paid', 'fine_type'],
  sortable: ['id', 'amount', 'created_at'],
  defaultSort: 'created_at',
  scopeFilter: async (req) => {
    if (!isStudent(req.user) && !isParent(req.user)) return null;
    const allowed = await accessibleStudentIds(req.user);
    if (!allowed?.length) return { $expr: { $eq: [1, 0] } };
    return { student_id: { $in: allowed.map(oid).filter(Boolean) } };
  },
});

finesRouter.post(
  '/:id/pay',
  requirePermission('library.edit'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const fine = plain(await Fine.findById(oid(id)));
    if (!fine) throw notFound('Fine not found');
    if (fine.paid) throw badRequest('This fine is already settled');

    /*
     * Settling the fine and recording the money are one act. Either both
     * happen or neither does: a fine marked paid with no income behind it is
     * money the school cannot account for, and income with the fine still
     * outstanding has the parent asked twice.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await Fine.updateOne({ _id: oid(id) }, {
        $set: {
          paid: 1,
          paid_date: new Date().toISOString().slice(0, 10),
          collected_by: oid(req.user.id),
        },
      }, opts);
      await Income.create([{
        campus_id: oid(fine.campus_id),
        category: 'LIBRARY_FINE',
        title: `Library fine #${id}`,
        amount: fine.amount,
        income_date: new Date().toISOString().slice(0, 10),
        recorded_by: oid(req.user.id),
      }], opts);
    });

    await logActivity({
      req,
      action: 'FEE_PAYMENT',
      module: 'library',
      entityType: 'Fine',
      entityId: id,
      description: `Collected library fine of ${fine.amount}`,
    });
    return ok(res, { id, paid: true });
  })
);
router.use('/fines', finesRouter);

router.get(
  '/summary',
  requirePermission('library.view'),
  asyncHandler(async (req, res) => {
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? {} : { campus_id: oid(campusId) };

    const [booksRow] = await Book.aggregate([
      { $match: scope },
      {
        $group: {
          _id: null,
          titles: { $sum: 1 },
          copies: { $sum: { $ifNull: ['$total_copies', 0] } },
          available: { $sum: { $ifNull: ['$available_copies', 0] } },
        },
      },
    ]);
    const books = booksRow || { titles: 0, copies: 0, available: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const [issued, overdue, finesRow] = await Promise.all([
      BookTransaction.countDocuments({ ...scope, status: 'ISSUED' }),
      // Still out, and past its date — the dates are text and sort correctly,
      // but a loan with no due date recorded is not overdue, so null is
      // excluded rather than being matched by `$lt`.
      BookTransaction.countDocuments({
        ...scope, status: 'ISSUED', due_date: { $ne: null, $lt: today },
      }),
      Fine.aggregate([
        { $match: { ...scope, paid: 0 } },
        { $group: { _id: null, n: { $sum: { $ifNull: ['$amount', 0] } } } },
      ]),
    ]);
    const unpaidFines = finesRow[0]?.n ?? 0;

    /*
     * The most borrowed titles.
     *
     * Grouped over the loans and the titles looked up afterwards. Grouping the
     * books instead would need every loan joined to every book first, which is
     * the expensive half of what the JOIN did and is not needed to rank them.
     */
    const counts = await BookTransaction.aggregate([
      { $match: scope },
      { $group: { _id: '$book_id', issue_count: { $sum: 1 } } },
      { $sort: { issue_count: -1 } },
      { $limit: 8 },
    ]);
    const titles = counts.length
      ? await Book.find({ _id: { $in: counts.map((c) => c._id) } }).select('title author').lean()
      : [];
    const titleById = new Map(titles.map((b) => [String(b._id), b]));
    const popular = counts.map((c) => ({
      id: String(c._id),
      title: titleById.get(String(c._id))?.title ?? null,
      author: titleById.get(String(c._id))?.author ?? null,
      issue_count: c.issue_count,
    }));

    return ok(res, { books, issued, overdue, unpaidFines, popular });
  })
);

export default router;
