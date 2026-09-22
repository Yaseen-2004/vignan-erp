import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
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
    const book = await get('SELECT * FROM books WHERE id = ?', [body.book_id]);
    if (!book) throw notFound('Book not found');
    if (book.available_copies < 1) throw badRequest('No copies of this title are available');
    if (body.member_type === 'STUDENT' && !body.student_id) throw badRequest('Select a student');
    if (body.member_type === 'FACULTY' && !body.faculty_id) throw badRequest('Select a faculty member');

    const dueDate = new Date(Date.now() + body.days * 86400000).toISOString().slice(0, 10);

    const transactionId = await transaction(async () => {
      const id = await insert('book_transactions', {
        campus_id: book.campus_id,
        book_id: book.id,
        member_type: body.member_type,
        student_id: body.member_type === 'STUDENT' ? body.student_id : null,
        faculty_id: body.member_type === 'FACULTY' ? body.faculty_id : null,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: dueDate,
        status: 'ISSUED',
        issued_by: req.user.id,
        remarks: body.remarks,
      });
      await update('books', book.id, { available_copies: book.available_copies - 1 });
      return id;
    })();

    await logActivity({
      req,
      action: 'CREATE',
      module: 'library',
      entityType: 'Book Transaction',
      entityId: transactionId,
      description: `Issued "${book.title}" (due ${dueDate})`,
    });
    return created(res, await get('SELECT * FROM book_transactions WHERE id = ?', [transactionId]));
  })
);

/** Return a book, raising a fine when it is late. */
transactionsRouter.post(
  '/:id/return',
  requirePermission('library.edit'),
  validateBody(z.object({ condition: z.enum(['GOOD', 'DAMAGED', 'LOST']).default('GOOD'), remarks: z.string().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const record = await get('SELECT * FROM book_transactions WHERE id = ?', [id]);
    if (!record) throw notFound('Transaction not found');
    if (record.status === 'RETURNED') throw badRequest('This book has already been returned');

    const today = new Date().toISOString().slice(0, 10);
    const overdueDays = Math.max(0, Math.floor((new Date(today) - new Date(record.due_date)) / 86400000));

    const result = await transaction(async () => {
      await update('book_transactions', id, {
        return_date: today,
        status: req.body.condition === 'LOST' ? 'LOST' : 'RETURNED',
        remarks: req.body.remarks,
      });

      if (req.body.condition !== 'LOST') {
        const book = await get('SELECT * FROM books WHERE id = ?', [record.book_id]);
        await update('books', record.book_id, { available_copies: Math.min(book.total_copies, book.available_copies + 1) });
      }

      let fineId = null;
      let fineAmount = 0;
      if (overdueDays > 0 || req.body.condition !== 'GOOD') {
        const book = await get('SELECT price FROM books WHERE id = ?', [record.book_id]);
        fineAmount =
          req.body.condition === 'LOST'
            ? Number(book?.price || 0) || 500
            : overdueDays * FINE_PER_DAY + (req.body.condition === 'DAMAGED' ? 100 : 0);
        if (fineAmount > 0) {
          fineId = await insert('fines', {
            campus_id: record.campus_id,
            book_transaction_id: id,
            student_id: record.student_id,
            faculty_id: record.faculty_id,
            fine_type: req.body.condition === 'GOOD' ? 'LATE_RETURN' : req.body.condition,
            amount: fineAmount,
            reason:
              req.body.condition === 'GOOD'
                ? `${overdueDays} day(s) overdue`
                : `Book returned ${req.body.condition.toLowerCase()}`,
          });
        }
      }
      return { fineId, fineAmount };
    })();

    if (result.fineAmount > 0 && record.student_id) {
      const student = await get('SELECT user_id FROM students WHERE id = ?', [record.student_id]);
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
    const id = Number(req.params.id);
    const fine = await get('SELECT * FROM fines WHERE id = ?', [id]);
    if (!fine) throw notFound('Fine not found');
    if (fine.paid) throw badRequest('This fine is already settled');

    await update('fines', id, { paid: 1, paid_date: new Date().toISOString().slice(0, 10), collected_by: req.user.id });
    await insert('income', {
      campus_id: fine.campus_id,
      category: 'LIBRARY_FINE',
      title: `Library fine #${id}`,
      amount: fine.amount,
      income_date: new Date().toISOString().slice(0, 10),
      recorded_by: req.user.id,
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
    const scope = isAdmin(req.user) && !campusId ? '' : ' WHERE campus_id = ?';
    const p = scope ? [campusId] : [];

    const books = await get(
      `SELECT COUNT(*) AS titles, COALESCE(SUM(total_copies), 0) AS copies,
              COALESCE(SUM(available_copies), 0) AS available FROM books${scope}`,
      p
    );
    const issued = Number(
      await scalar(`SELECT COUNT(*) AS n FROM book_transactions${scope}${scope ? ' AND' : ' WHERE'} status = 'ISSUED'`, p)
    );
    const overdue = Number(
      await scalar(
        `SELECT COUNT(*) AS n FROM book_transactions${scope}${scope ? ' AND' : ' WHERE'} status = 'ISSUED' AND substr(due_date, 1, 10) < to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        p
      )
    );
    const unpaidFines = Number(
      await scalar(`SELECT COALESCE(SUM(amount), 0) AS n FROM fines${scope}${scope ? ' AND' : ' WHERE'} paid = 0`, p)
    );
    const popular = await all(
      `SELECT b.id, b.title, b.author, COUNT(bt.id) AS issue_count
         FROM books b JOIN book_transactions bt ON bt.book_id = b.id
        ${scope ? 'WHERE b.campus_id = ?' : ''}
        GROUP BY b.id ORDER BY issue_count DESC LIMIT 8`,
      p
    );
    return ok(res, { books, issued, overdue, unpaidFines, popular });
  })
);

export default router;
