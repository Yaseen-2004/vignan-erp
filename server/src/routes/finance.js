import { Router } from 'express';
import { z } from 'zod';
import { Campus, Class, Expense, Faculty, FacultyAttendance, FeePayment, FeeReceipt, FeeStructure, FuelRecord, Income, Parent, Payroll, PettyCash, SalaryStructure, Section, Student, StudentFee, StudentParent, VehicleMaintenance } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { lift, plain, startsWith } from '../db/mongo/query.js';
import { sameId } from '../lib/scope.js';
import { asyncHandler, ok, created } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import { isAdmin, accessibleStudentIds, assertStudentAccess, isStudent, isParent, facultyIdOf } from '../lib/scope.js';
import { notify } from '../lib/notify.js';
import { amountInWords } from '../lib/money.js';
import { payslipNumbers, receiptNumbers } from '../lib/codes.js';

const router = Router();

/** Student-scoped WHERE fragment shared by the fee endpoints. */
async function feeScope(req, field = 'student_id') {
  const allowed = await accessibleStudentIds(req.user);
  if (allowed === null) return null;
  // Entitled to none means none — `$expr` because a condition on a field can
  // be dropped, and a dropped filter over money is the whole school's.
  if (!allowed.length) return { $expr: { $eq: [1, 0] } };
  return { [field]: { $in: allowed.map(oid).filter(Boolean) } };
}

// ------------------------------------------------------------ fee categories
router.use(
  '/fee-categories',
  createResourceRouter({
    table: 'fee_categories',
    module: 'fees',
    entityType: 'Fee Category',
    alias: 'fc',
    searchable: ['fc.name', 'fc.code'],
    filterable: ['status', 'frequency'],
    sortable: ['id', 'name'],
    required: ['code', 'name'],
    defaultSort: 'name',
  })
);

// ----------------------------------------------------------- fee structures
const structuresRouter = createResourceRouter({
  table: 'fee_structures',
  module: 'fees',
  entityType: 'Fee Structure',
  alias: 'fs',
  select: `fs.*, fc.name AS category_name, fc.frequency, c.name AS class_name, ay.name AS academic_year_name,
           (SELECT COUNT(*) FROM student_fees sf WHERE sf.fee_structure_id = fs.id) AS assigned_count`,
  joins: `JOIN fee_categories fc ON fc.id = fs.fee_category_id
          LEFT JOIN classes c ON c.id = fs.class_id
          JOIN academic_years ay ON ay.id = fs.academic_year_id`,
  searchable: ['fs.name', 'fc.name'],
  filterable: ['class_id', 'academic_year_id', 'fee_category_id', 'status'],
  sortable: ['id', 'name', 'amount', 'due_date'],
  required: ['name', 'amount', 'fee_category_id', 'academic_year_id'],
  defaultSort: 'due_date',
});

/**
 * Assign a fee structure to every active student of its class (or to a
 * supplied list). Existing assignments are left untouched.
 */
structuresRouter.post(
  '/:id/assign',
  requirePermission('fees.manage', 'fees.create'),
  validateBody(
    z.object({
      student_ids: z.array(z.coerce.number().int().positive()).optional(),
      discount_amount: z.coerce.number().min(0).default(0),
      concession_reason: z.string().max(200).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const structure = plain(await FeeStructure.findById(oid(id)));
    if (!structure) throw notFound('Fee structure not found');
    if (!isAdmin(req.user) && !sameId(structure.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    // The pupils named, or every active pupil of the structure's class.
    const students = plain(
      await Student.find(
        req.body.student_ids?.length
          ? { _id: { $in: req.body.student_ids.map(oid).filter(Boolean) }, status: 'ACTIVE' }
          : { class_id: oid(structure.class_id), status: 'ACTIVE' }
      ).select('user_id')
    );

    if (!students.length) throw badRequest('No active students matched this fee structure');

    // Who already has it, fetched once rather than asked per pupil.
    const already = new Set(
      (await StudentFee.find({
        student_id: { $in: students.map((x) => oid(x.id)) },
        fee_structure_id: oid(id),
      }).select('student_id').lean()).map((f) => String(f.student_id))
    );

    const toAssign = students.filter((student) => !already.has(student.id));

    const assigned = await transaction(async (session) => {
      const opts = session ? { session } : {};
      if (!toAssign.length) return 0;

      await StudentFee.insertMany(
        toAssign.map((student) => ({
          campus_id: oid(structure.campus_id),
          student_id: oid(student.id),
          fee_structure_id: oid(id),
          academic_year_id: oid(structure.academic_year_id),
          total_amount: structure.amount,
          discount_amount: req.body.discount_amount || 0,
          concession_reason: req.body.concession_reason,
          due_date: structure.due_date,
          status: 'PENDING',
        })),
        { ...opts, ordered: false }
      );
      return toAssign.length;
    });

    // Told afterwards, outside the transaction: a notification that fails
    // must not undo a fee that was properly assigned.
    for (const student of toAssign) {
      if (!student.user_id) continue;
      await notify({
        userId: String(student.user_id),
        campusId: structure.campus_id,
        type: 'FEE_DUE',
        title: `Fee assigned: ${structure.name}`,
        body: `Amount due ${structure.amount}${structure.due_date ? ` by ${structure.due_date}` : ''}.`,
        link: '/parent/fees',
      });
    }

    await logActivity({
      req,
      action: 'CREATE',
      module: 'fees',
      entityType: 'Fee Structure',
      entityId: id,
      description: `Assigned fee structure "${structure.name}" to ${assigned} student(s)`,
    });
    return created(res, { assigned });
  })
);
router.use('/fee-structures', structuresRouter);

// -------------------------------------------------------------- student fees
router.use(
  '/student-fees',
  createResourceRouter({
    table: 'student_fees',
    module: 'fees',
    entityType: 'Student Fee',
    alias: 'sf',
    select: `sf.*, s.first_name, s.last_name, s.admission_number, s.roll_number,
             fs.name AS fee_name, fc.name AS category_name, c.name AS class_name, sec.name AS section_name,
             (sf.total_amount - sf.discount_amount - sf.paid_amount) AS balance`,
    joins: `JOIN students s ON s.id = sf.student_id
            JOIN fee_structures fs ON fs.id = sf.fee_structure_id
            JOIN fee_categories fc ON fc.id = fs.fee_category_id
            LEFT JOIN classes c ON c.id = s.class_id
            LEFT JOIN sections sec ON sec.id = s.section_id`,
    searchable: ['s.first_name', 's.admission_number', 'fs.name'],
    filterable: ['student_id', 'status', 'academic_year_id', 'fee_structure_id'],
    sortable: ['id', 'due_date', 'total_amount', 'paid_amount'],
    defaultSort: 'due_date',
    scopeClause: feeScope,
    permissions: { view: 'fees.view', create: 'fees.create', edit: 'fees.edit', delete: 'fees.delete' },
  })
);

/**
 * Collect a fee payment: records the payment, updates the balance and issues a
 * numbered receipt — all inside one transaction.
 */
router.post(
  '/collect',
  requirePermission('payments.create'),
  validateBody(
    z.object({
      student_fee_id: z.coerce.number().int().positive(),
      amount: z.coerce.number().positive('Enter an amount greater than zero'),
      payment_mode: z.enum(['CASH', 'CHEQUE', 'ONLINE', 'UPI', 'CARD', 'NEFT', 'DD']).default('CASH'),
      payment_date: z.string().max(20).optional(),
      transaction_ref: z.string().max(80).optional().nullable(),
      bank_name: z.string().max(80).optional().nullable(),
      remarks: z.string().max(300).optional().nullable(),
    })
  ),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const feeDoc = await StudentFee.findById(oid(body.student_fee_id))
      .populate('student_id', 'first_name last_name admission_number user_id')
      .populate('fee_structure_id', 'name');
    if (!feeDoc) throw notFound('Fee record not found');

    const studentFee = {
      ...lift(feeDoc, {
        student_id: {
          first_name: 'first_name', last_name: 'last_name',
          admission_number: 'admission_number', user_id: 'student_user_id',
        },
        fee_structure_id: { name: 'fee_name' },
      }),
    };
    if (!isAdmin(req.user) && !sameId(studentFee.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    const payable = studentFee.total_amount - studentFee.discount_amount - studentFee.paid_amount;
    if (payable <= 0) throw badRequest('This fee has already been settled');
    if (body.amount > payable + 0.01) throw badRequest(`The outstanding balance is only ${payable.toFixed(2)}`);

    const paymentDate = body.payment_date || new Date().toISOString().slice(0, 10);

    const result = await transaction(async (session) => {
      const opts = session ? { session } : {};

      /*
       * The balance is adjusted by the database, not written from a figure
       * read a moment ago.
       *
       * Two cashiers taking payments from the same family at the same counter
       * would both have read the same paid_amount and both written their own
       * total, and one family's money would simply not be there — the fee
       * would show as partly paid when it had been paid twice over. `$inc`
       * cannot lose a payment that way.
       *
       * The condition rides in the filter for the same reason: it is checked
       * at the moment of the write, so a payment that would overshoot the
       * balance because another was taken in between does not apply at all.
       */
      const applied = await StudentFee.updateOne(
        {
          _id: oid(studentFee.id),
          $expr: {
            $lte: [
              body.amount,
              {
                $add: [
                  { $subtract: [
                    { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$discount_amount', 0] }] },
                    { $ifNull: ['$paid_amount', 0] },
                  ] },
                  0.01,
                ],
              },
            ],
          },
        },
        [
          { $set: { paid_amount: { $add: [{ $ifNull: ['$paid_amount', 0] }, body.amount] } } },
          {
            $set: {
              status: {
                $cond: [
                  {
                    $lte: [
                      { $subtract: [
                        { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$discount_amount', 0] }] },
                        { $ifNull: ['$paid_amount', 0] },
                      ] },
                      0.01,
                    ],
                  },
                  'PAID',
                  'PARTIAL',
                ],
              },
            },
          },
        ],
        opts
      );

      // Nothing changed means another payment got there first and this one
      // would now exceed the balance. Better refused than taken twice.
      if (!applied.modifiedCount) {
        throw badRequest('That payment no longer fits the outstanding balance. Reload and try again.');
      }

      const [payment] = await FeePayment.create([{
        campus_id: oid(studentFee.campus_id),
        student_fee_id: oid(studentFee.id),
        student_id: oid(studentFee.student_id),
        amount: body.amount,
        payment_date: paymentDate,
        payment_mode: body.payment_mode,
        transaction_ref: body.transaction_ref,
        bank_name: body.bank_name,
        remarks: body.remarks,
        status: 'SUCCESS',
        collected_by: oid(req.user.id),
      }], opts);

      // Read back for the balance actually left, rather than the one worked
      // out from what was read before the write.
      const after = await StudentFee.findById(oid(studentFee.id)).select('total_amount discount_amount paid_amount').lean();
      const balance = Number(after.total_amount || 0) - Number(after.discount_amount || 0) - Number(after.paid_amount || 0);

      const year = new Date().getFullYear();
      const receiptNumber = (await receiptNumbers(studentFee.campus_id, year)).take();

      const [receipt] = await FeeReceipt.create([{
        campus_id: oid(studentFee.campus_id),
        fee_payment_id: payment._id,
        student_id: oid(studentFee.student_id),
        receipt_number: receiptNumber,
        amount: body.amount,
        amount_in_words: amountInWords(body.amount),
        issued_by: oid(req.user.id),
      }], opts);

      // Fee income also lands in the income ledger.
      await Income.create([{
        campus_id: oid(studentFee.campus_id),
        category: 'FEES',
        title: `${studentFee.fee_name} — ${studentFee.admission_number}`,
        amount: body.amount,
        income_date: paymentDate,
        payment_mode: body.payment_mode,
        reference: receiptNumber,
        recorded_by: oid(req.user.id),
      }], opts);

      return {
        paymentId: String(payment._id),
        receiptId: String(receipt._id),
        receiptNumber,
        balance,
      };
    });

    if (studentFee.student_user_id) {
      await notify({
        userId: studentFee.student_user_id,
        campusId: studentFee.campus_id,
        type: 'FEE_PAYMENT',
        title: 'Payment received',
        body: `Receipt ${result.receiptNumber} for ${body.amount}.`,
        link: '/parent/fees',
      });
    }
    // Every family linked to this pupil, with a sign-in of their own.
    const links = await StudentParent.find({ student_id: oid(studentFee.student_id) })
      .select('parent_id').lean();
    const parents = links.length
      ? plain(
        await Parent.find({ _id: { $in: links.map((l) => l.parent_id) }, user_id: { $ne: null } })
          .select('user_id campus_id')
      )
      : [];
    for (const parent of parents) {
      await notify({
        userId: parent.user_id,
        campusId: studentFee.campus_id,
        type: 'FEE_PAYMENT',
        title: 'Fee payment received',
        body: `Receipt ${result.receiptNumber} for ${body.amount}.`,
        link: '/parent/fees',
      });
    }

    await logActivity({
      req,
      action: 'FEE_PAYMENT',
      module: 'payments',
      entityType: 'Fee Payment',
      entityId: result.paymentId,
      description: `Collected ${body.amount} from ${studentFee.admission_number} (${result.receiptNumber})`,
      newValues: { amount: body.amount, mode: body.payment_mode, receipt: result.receiptNumber },
    });

    return created(res, {
      payment_id: result.paymentId,
      receipt_id: result.receiptId,
      receipt_number: result.receiptNumber,
      balance: result.balance,
    });
  })
);

// -------------------------------------------------------------- payments
router.use(
  '/payments',
  createResourceRouter({
    table: 'fee_payments',
    module: 'payments',
    entityType: 'Fee Payment',
    alias: 'fp',
    select: `fp.*, s.first_name, s.last_name, s.admission_number, c.name AS class_name,
             fs.name AS fee_name, u.full_name AS collected_by_name, fr.receipt_number, fr.id AS receipt_id`,
    joins: `JOIN students s ON s.id = fp.student_id
            LEFT JOIN classes c ON c.id = s.class_id
            JOIN student_fees sf ON sf.id = fp.student_fee_id
            JOIN fee_structures fs ON fs.id = sf.fee_structure_id
            LEFT JOIN users u ON u.id = fp.collected_by
            LEFT JOIN fee_receipts fr ON fr.fee_payment_id = fp.id`,
    searchable: ['s.first_name', 's.admission_number', 'fp.transaction_ref'],
    filterable: ['student_id', 'payment_mode', 'status', 'payment_date'],
    sortable: ['id', 'payment_date', 'amount'],
    defaultSort: 'payment_date',
    readOnly: false,
    permissions: { view: 'payments.view', create: 'payments.create', edit: 'payments.edit', delete: 'payments.delete' },
    scopeClause: async (req) => await feeScope(req, 'fp.student_id'),
  })
);

/** Printable receipt payload. */
router.get(
  '/receipts/:id',
  requirePermission('payments.view', 'fees.view'),
  asyncHandler(async (req, res) => {
    const receiptDoc = await FeeReceipt.findById(oid(req.params.id))
      .populate('student_id', 'first_name last_name admission_number roll_number class_id section_id')
      .populate({
        path: 'fee_payment_id',
        select: 'amount payment_mode payment_date transaction_ref student_fee_id',
        populate: {
          path: 'student_fee_id',
          select: 'total_amount discount_amount paid_amount fee_structure_id',
          populate: { path: 'fee_structure_id', select: 'name fee_category_id', populate: { path: 'fee_category_id', select: 'name' } },
        },
      })
      .populate('issued_by', 'full_name');
    if (!receiptDoc) throw notFound('Receipt not found');

    const studentFeeOnReceipt = receiptDoc.fee_payment_id?.student_fee_id;
    const pupil = receiptDoc.student_id;
    const [klass, section] = await Promise.all([
      pupil?.class_id ? Class.findById(pupil.class_id).select('name').lean() : null,
      pupil?.section_id ? Section.findById(pupil.section_id).select('name').lean() : null,
    ]);

    const receipt = {
      ...plain(receiptDoc),
      payment_amount: receiptDoc.fee_payment_id?.amount ?? null,
      payment_mode: receiptDoc.fee_payment_id?.payment_mode ?? null,
      payment_date: receiptDoc.fee_payment_id?.payment_date ?? null,
      transaction_ref: receiptDoc.fee_payment_id?.transaction_ref ?? null,
      first_name: pupil?.first_name ?? null,
      last_name: pupil?.last_name ?? null,
      admission_number: pupil?.admission_number ?? null,
      roll_number: pupil?.roll_number ?? null,
      class_name: klass?.name ?? null,
      section_name: section?.name ?? null,
      fee_name: studentFeeOnReceipt?.fee_structure_id?.name ?? null,
      category_name: studentFeeOnReceipt?.fee_structure_id?.fee_category_id?.name ?? null,
      issued_by_name: receiptDoc.issued_by?.full_name ?? null,
      total_amount: studentFeeOnReceipt?.total_amount ?? null,
      discount_amount: studentFeeOnReceipt?.discount_amount ?? null,
      paid_amount: studentFeeOnReceipt?.paid_amount ?? null,
      balance: studentFeeOnReceipt
        ? Number(studentFeeOnReceipt.total_amount || 0)
          - Number(studentFeeOnReceipt.discount_amount || 0)
          - Number(studentFeeOnReceipt.paid_amount || 0)
        : null,
    };
    if (!receipt) throw notFound('Receipt not found');
    await assertStudentAccess(req.user, receipt.student_id);

    const campus = await Campus.findById(oid(receipt.campus_id))
      .select('name address city state pincode phone email logo').lean();
    return ok(res, { receipt, campus });
  })
);

router.get(
  '/receipts',
  requirePermission('payments.view', 'fees.view'),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);
    Object.assign(filter, (await feeScope(req)) || {});
    if (req.query.student_id) filter.student_id = oid(req.query.student_id);

    const rows = lift(
      await FeeReceipt.find(filter)
        .populate('student_id', 'first_name last_name admission_number')
        .populate('fee_payment_id', 'payment_mode payment_date')
        .sort({ issued_at: -1 })
        .limit(200),
      {
        student_id: {
          first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number',
        },
        fee_payment_id: { payment_mode: 'payment_mode', payment_date: 'payment_date' },
      }
    );
    return ok(res, rows);
  })
);

/** Outstanding balances, with an optional class filter. */
router.get(
  '/pending',
  requirePermission('fees.view'),
  asyncHandler(async (req, res) => {
    /*
     * Still owing: a comparison between three fields of the same record, which
     * a plain filter cannot make. The 0.01 keeps rounding dust from being
     * reported to a parent as a debt.
     */
    const owing = {
      $expr: {
        $gt: [
          { $subtract: [
            { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$discount_amount', 0] }] },
            { $ifNull: ['$paid_amount', 0] },
          ] },
          0.01,
        ],
      },
    };

    const filter = { ...owing };
    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);
    Object.assign(filter, (await feeScope(req)) || {});

    // The class belongs to the pupil, not the fee — the join reached it.
    if (req.query.class_id) {
      const pupils = await Student.find({ class_id: oid(req.query.class_id) }).select('_id').lean();
      filter.student_id = { $in: pupils.map((x) => x._id) };
    }

    const today = new Date().toISOString().slice(0, 10);
    if (req.query.overdue === 'true') filter.due_date = { $ne: null, $lt: today };

    const rows = lift(
      await StudentFee.find(filter)
        .select('student_id total_amount discount_amount paid_amount due_date status fee_structure_id')
        .populate('student_id', 'first_name last_name admission_number roll_number phone class_id section_id')
        .populate('fee_structure_id', 'name')
        .sort({ due_date: 1 })
        .limit(500),
      {
        student_id: {
          first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number',
          roll_number: 'roll_number', phone: 'phone',
        },
        'student_id.class_id': { name: 'class_name' },
        'student_id.section_id': { name: 'section_name' },
        fee_structure_id: { name: 'fee_name' },
      }
    ).map((row) => ({
      ...row,
      balance: Number(row.total_amount || 0) - Number(row.discount_amount || 0) - Number(row.paid_amount || 0),
      // What the CASE produced: past its date, and something still owing.
      is_overdue: row.due_date && String(row.due_date).slice(0, 10) < today ? 1 : 0,
    }));

    const totals = rows.reduce(
      (acc, row) => ({
        count: acc.count + 1,
        amount: acc.amount + row.balance,
        overdue: acc.overdue + (row.is_overdue ? row.balance : 0),
      }),
      { count: 0, amount: 0, overdue: 0 }
    );
    return ok(res, { rows, totals });
  })
);

/** Finance dashboard figures. */
router.get(
  '/summary',
  requirePermission('fees.view', 'finance.view'),
  asyncHandler(async (req, res) => {
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? {} : { campus_id: oid(campusId) };

    const now = new Date();
    const thisDay = now.toISOString().slice(0, 10);
    const thisMonth = thisDay.slice(0, 7);
    const thisYear = thisDay.slice(0, 4);

    /** COALESCE(SUM(x), 0) over one collection. */
    const sumOf = async (Model, match, field = 'amount') => {
      const [row] = await Model.aggregate([
        { $match: { ...scope, ...match } },
        { $group: { _id: null, n: { $sum: { $ifNull: [`$${field}`, 0] } } } },
      ]);
      return row?.n ?? 0;
    };

    const [today, month, year, income, expenses, payrollMonth, fuel, maintenance] = await Promise.all([
      sumOf(FeePayment, { payment_date: thisDay }),
      sumOf(FeePayment, { payment_date: startsWith(thisMonth) }),
      sumOf(FeePayment, { payment_date: startsWith(thisYear) }),
      sumOf(Income, { income_date: startsWith(thisYear) }),
      sumOf(Expense, { expense_date: startsWith(thisYear), status: 'APPROVED' }),
      sumOf(Payroll, { month: now.getMonth() + 1, year: Number(thisYear) }, 'net_salary'),
      sumOf(FuelRecord, { fuel_date: startsWith(thisYear) }, 'total_cost'),
      sumOf(VehicleMaintenance, { service_date: startsWith(thisYear) }, 'cost'),
    ]);
    const transportExpense = fuel + maintenance;

    // Everything still owed, counted and totalled together.
    const [pendingRow] = await StudentFee.aggregate([
      {
        $match: {
          ...scope,
          $expr: {
            $gt: [
              { $subtract: [
                { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$discount_amount', 0] }] },
                { $ifNull: ['$paid_amount', 0] },
              ] },
              0.01,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amount: {
            $sum: {
              $subtract: [
                { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$discount_amount', 0] }] },
                { $ifNull: ['$paid_amount', 0] },
              ],
            },
          },
        },
      },
    ]);
    const pending = pendingRow || { count: 0, amount: 0 };

    // Twelve months, oldest first — sorted descending, limited, then reversed,
    // so it is the twelve most recent rather than the first twelve on record.
    const monthlyTrend = (await FeePayment.aggregate([
      { $match: scope },
      { $group: { _id: { $substrBytes: ['$payment_date', 0, 7] }, collected: { $sum: { $ifNull: ['$amount', 0] } } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ])).map((m) => ({ month: m._id, collected: m.collected })).reverse();

    const recentDocs = await FeePayment.find(scope)
      .select('amount payment_date payment_mode student_id')
      .populate('student_id', 'first_name last_name admission_number')
      .sort({ created_at: -1 })
      .limit(10);
    const receiptsFor = new Map(
      (await FeeReceipt.find({ fee_payment_id: { $in: recentDocs.map((x) => x._id) } })
        .select('fee_payment_id receipt_number').lean())
        .map((r) => [String(r.fee_payment_id), r.receipt_number])
    );
    const recent = lift(recentDocs, {
      student_id: {
        first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number',
      },
    }).map((row) => ({ ...row, receipt_number: receiptsFor.get(row.id) ?? null }));

    const byMode = (await FeePayment.aggregate([
      { $match: { ...scope, payment_date: startsWith(thisMonth) } },
      { $group: { _id: '$payment_mode', count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$amount', 0] } } } },
    ])).map((m) => ({ payment_mode: m._id, count: m.count, amount: m.amount }));

    return ok(res, {
      collection: { today, month, year },
      pending,
      income,
      expenses,
      net: income - expenses,
      payrollMonth,
      transportExpense,
      monthlyTrend,
      recent,
      byMode,
    });
  })
);

// ------------------------------------------------------- income & expenses
router.use(
  '/income',
  createResourceRouter({
    table: 'income',
    module: 'finance',
    entityType: 'Income',
    alias: 'i',
    select: `i.*, u.full_name AS recorded_by_name`,
    joins: `LEFT JOIN users u ON u.id = i.recorded_by`,
    searchable: ['i.title', 'i.category', 'i.reference'],
    filterable: ['category', 'payment_mode'],
    sortable: ['id', 'income_date', 'amount'],
    required: ['category', 'title', 'amount'],
    defaultSort: 'income_date',
    beforeCreate: (data, req) => ({ ...data, recorded_by: req.user.id }),
  })
);

router.use(
  '/expenses',
  createResourceRouter({
    table: 'expenses',
    module: 'finance',
    entityType: 'Expense',
    alias: 'e',
    select: `e.*, u.full_name AS recorded_by_name, a.full_name AS approved_by_name`,
    joins: `LEFT JOIN users u ON u.id = e.recorded_by LEFT JOIN users a ON a.id = e.approved_by`,
    searchable: ['e.title', 'e.category', 'e.vendor', 'e.bill_number'],
    filterable: ['category', 'status', 'payment_mode'],
    sortable: ['id', 'expense_date', 'amount'],
    required: ['category', 'title', 'amount'],
    defaultSort: 'expense_date',
    beforeCreate: (data, req) => ({ ...data, recorded_by: req.user.id }),
  })
);

router.use(
  '/petty-cash',
  createResourceRouter({
    table: 'petty_cash',
    module: 'finance',
    entityType: 'Petty Cash',
    alias: 'pc',
    select: `pc.*, u.full_name AS handled_by_name`,
    joins: `LEFT JOIN users u ON u.id = pc.handled_by`,
    searchable: ['pc.purpose'],
    filterable: ['entry_type'],
    sortable: ['id', 'entry_date', 'amount'],
    required: ['entry_type', 'amount', 'purpose'],
    defaultSort: 'entry_date',
    beforeCreate: async (data, req) => {
      const last = await PettyCash.findOne({ campus_id: oid(req.user.campus_id) })
        .sort({ _id: -1 }).select('balance_after').lean();
      const previous = last?.balance_after ?? 0;
      const delta = data.entry_type === 'IN' ? Number(data.amount) : -Number(data.amount);
      return { ...data, handled_by: req.user.id, balance_after: previous + delta };
    },
  })
);

// ---------------------------------------------------------------- payroll
router.use(
  '/salary-structures',
  createResourceRouter({
    table: 'salary_structures',
    module: 'payroll',
    entityType: 'Salary Structure',
    alias: 'ss',
    select: `ss.*, u.full_name, u.email, r.code AS role_code, f.faculty_code, f.staff_type,
             (ss.basic_salary + ss.hra + ss.da + ss.conveyance + ss.medical + ss.other_allowances) AS gross,
             (ss.pf_deduction + ss.tax_deduction + ss.other_deductions) AS deductions`,
    joins: `JOIN users u ON u.id = ss.user_id
            JOIN roles r ON r.id = u.role_id
            LEFT JOIN faculty f ON f.user_id = u.id`,
    searchable: ['u.full_name', 'f.faculty_code'],
    filterable: ['user_id', 'status'],
    sortable: ['id', 'effective_from', 'basic_salary'],
    required: ['user_id', 'basic_salary'],
    defaultSort: 'effective_from',
    // Staff without payroll.manage may only see their own structure.
    scopeClause: (req) => {
      if (isAdmin(req.user) || req.permissions.has('payroll.manage') || req.permissions.has('payroll.edit')) return null;
      return { clause: 'ss.user_id = ?', params: [req.user.id] };
    },
  })
);

const payrollRouter = createResourceRouter({
  table: 'payroll',
  module: 'payroll',
  entityType: 'Payroll',
  alias: 'p',
  select: `p.*, u.full_name, u.email, r.code AS role_code, f.faculty_code, f.staff_type,
           d.name AS department_name, pu.full_name AS processed_by_name`,
  joins: `JOIN users u ON u.id = p.user_id
          JOIN roles r ON r.id = u.role_id
          LEFT JOIN faculty f ON f.user_id = u.id
          LEFT JOIN departments d ON d.id = f.department_id
          LEFT JOIN users pu ON pu.id = p.processed_by`,
  searchable: ['u.full_name', 'p.payslip_number'],
  filterable: ['user_id', 'month', 'year', 'status'],
  sortable: ['id', 'year', 'net_salary'],
  required: ['user_id', 'month', 'year'],
  defaultSort: 'year',
  scopeClause: (req) => {
    if (isAdmin(req.user) || req.permissions.has('payroll.manage') || req.permissions.has('payroll.edit')) return null;
    return { clause: 'p.user_id = ?', params: [req.user.id] };
  },
});

/** Generate payroll for a month from the active salary structures. */
payrollRouter.post(
  '/generate',
  requirePermission('payroll.create'),
  validateBody(
    z.object({
      month: z.coerce.number().int().min(1).max(12),
      year: z.coerce.number().int().min(2000).max(2100),
      user_ids: z.array(z.coerce.number().int().positive()).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { month, year } = req.body;
    const campusId = req.user.campus_id;

    const structures = plain(
      await SalaryStructure.find(
        req.body.user_ids?.length
          ? { status: 'ACTIVE', user_id: { $in: req.body.user_ids.map(oid).filter(Boolean) } }
          : { status: 'ACTIVE', ...(campusId ? { campus_id: oid(campusId) } : {}) }
      )
    );

    if (!structures.length) throw badRequest('No active salary structures were found');

    const workingDays = new Date(year, month, 0).getDate();

    // Built once for the whole run rather than per payslip.
    const payslips = await payslipNumbers(year, month);

    /*
     * Everything the run needs, fetched once for everybody rather than three
     * queries per payslip. A school of two hundred staff was six hundred round
     * trips inside one transaction.
     */
    const userIds = structures.map((x) => oid(x.user_id)).filter(Boolean);

    const alreadyPaid = new Set(
      (await Payroll.find({ user_id: { $in: userIds }, month, year }).select('user_id').lean())
        .map((r) => String(r.user_id))
    );

    const staff = await Faculty.find({ user_id: { $in: userIds } }).select('user_id').lean();
    const facultyFor = new Map(staff.map((f) => [String(f.user_id), f._id]));

    /*
     * Days present and absent in this month. The dates are text, so the month
     * is matched by its prefix — `2026-09` — which is what the two substr()
     * casts were doing, without converting anything.
     */
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const attendanceRows = await FacultyAttendance.aggregate([
      { $match: { faculty_id: { $in: [...facultyFor.values()] }, attendance_date: startsWith(monthPrefix) } },
      {
        $group: {
          _id: '$faculty_id',
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        },
      },
    ]);
    const attendanceFor = new Map(attendanceRows.map((a) => [String(a._id), a]));

    const summary = await transaction(async (session) => {
      const opts = session ? { session } : {};
      let generated = 0;
      let skipped = 0;
      const payslipsToWrite = [];

      for (const structure of structures) {
        if (alreadyPaid.has(String(structure.user_id))) {
          skipped += 1;
          continue;
        }

        const facultyId = facultyFor.get(String(structure.user_id));
        const attendance = facultyId ? attendanceFor.get(String(facultyId)) : null;

        const allowances =
          structure.hra + structure.da + structure.conveyance + structure.medical + structure.other_allowances;
        const lopDays = attendance?.absent ?? 0;
        const perDay = (structure.basic_salary + allowances) / workingDays;
        const lopAmount = Number((perDay * lopDays).toFixed(2));
        const deductions = structure.pf_deduction + structure.tax_deduction + structure.other_deductions + lopAmount;
        const gross = structure.basic_salary + allowances;

        payslipsToWrite.push({
          campus_id: oid(structure.campus_id),
          user_id: oid(structure.user_id),
          month,
          year,
          basic_salary: structure.basic_salary,
          total_allowances: allowances,
          total_deductions: deductions,
          working_days: workingDays,
          present_days: attendance?.present ?? workingDays,
          lop_days: lopDays,
          gross_salary: gross,
          net_salary: Number((gross - deductions).toFixed(2)),
          payslip_number: payslips.take(),
          status: 'PROCESSED',
          processed_by: oid(req.user.id),
        });
        generated += 1;
      }

      if (payslipsToWrite.length) {
        await Payroll.insertMany(payslipsToWrite, { ...opts, ordered: false });
      }
      return { generated, skipped };
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'payroll',
      entityType: 'Payroll',
      description: `Generated payroll for ${month}/${year}: ${summary.generated} payslip(s)`,
      newValues: summary,
    });
    return created(res, summary);
  })
);

/** Mark payslips paid. */
payrollRouter.post(
  '/:id/pay',
  requirePermission('payroll.approve', 'payroll.manage'),
  validateBody(
    z.object({
      payment_date: z.string().max(20).optional(),
      payment_mode: z.string().max(20).default('NEFT'),
      remarks: z.string().max(200).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const record = plain(await Payroll.findById(oid(id)));
    if (!record) throw notFound('Payroll record not found');
    if (record.status === 'PAID') throw badRequest('This payslip is already marked paid');

    /*
     * Marking it paid and recording the expense are one act. A payslip marked
     * paid with no expense behind it is money the school cannot account for,
     * exactly as with a settled fine.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await Payroll.updateOne({ _id: oid(id) }, {
        $set: {
          status: 'PAID',
          payment_date: req.body.payment_date || new Date().toISOString().slice(0, 10),
          payment_mode: req.body.payment_mode,
          remarks: req.body.remarks,
        },
      }, opts);

      // Salary paid is an institutional expense.
      await Expense.create([{
        campus_id: oid(record.campus_id),
        category: 'PAYROLL',
        title: `Salary ${record.month}/${record.year} — ${record.payslip_number}`,
        amount: record.net_salary,
        expense_date: req.body.payment_date || new Date().toISOString().slice(0, 10),
        payment_mode: req.body.payment_mode,
        status: 'APPROVED',
        recorded_by: oid(req.user.id),
        approved_by: oid(req.user.id),
      }], opts);
    });

    await notify({
      userId: record.user_id,
      campusId: record.campus_id,
      type: 'PAYSLIP',
      title: 'Salary credited',
      body: `Your payslip ${record.payslip_number} has been marked paid.`,
      link: '/faculty/payslips',
    });

    await logActivity({
      req,
      action: 'APPROVE',
      module: 'payroll',
      entityType: 'Payroll',
      entityId: id,
      description: `Marked payslip ${record.payslip_number} as paid`,
      oldValues: { status: record.status },
      newValues: { status: 'PAID' },
    });
    return ok(res, plain(await Payroll.findById(oid(id))));
  })
);

/** Payslip payload — the owner or a payroll manager may fetch it. */
payrollRouter.get(
  '/:id/payslip',
  requirePermission('payroll.view'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const payrollDoc = await Payroll.findById(oid(id)).populate('user_id', 'full_name email');
    if (!payrollDoc) throw notFound('Payslip not found');

    /*
     * The staff details hang off the *account*, not off the payslip: a payslip
     * names a user, and the faculty record is found from there. That is the
     * direction the LEFT JOIN read it, and it is why somebody on payroll who
     * is not teaching staff still gets a payslip.
     */
    const member = await Faculty.findOne({ user_id: payrollDoc.user_id?._id })
      .select('faculty_code designation bank_account pan_number department_id')
      .populate('department_id', 'name');

    const record = {
      ...lift(payrollDoc, { user_id: { full_name: 'full_name', email: 'email' } }),
      faculty_code: member?.faculty_code ?? null,
      designation: member?.designation ?? null,
      bank_account: member?.bank_account ?? null,
      pan_number: member?.pan_number ?? null,
      department_name: member?.department_id?.name ?? null,
    };

    const canManage = isAdmin(req.user) || req.permissions.has('payroll.manage') || req.permissions.has('payroll.edit');
    if (!canManage && !sameId(record.user_id, req.user.id)) throw forbidden('You may only view your own payslip');

    const structure = plain(
      await SalaryStructure.findOne({ user_id: oid(record.user_id), status: 'ACTIVE' })
        .sort({ effective_from: -1 })
    );
    const campus = await Campus.findById(oid(record.campus_id))
      .select('name address city phone email').lean();
    return ok(res, { payslip: record, structure, campus, amountInWords: amountInWords(record.net_salary) });
  })
);
router.use('/payroll', payrollRouter);

export default router;
