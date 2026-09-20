import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
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
async function feeScope(req, column = 'sf.student_id') {
  const allowed = await accessibleStudentIds(req.user);
  if (allowed === null) return null;
  if (!allowed.length) return { clause: '1 = 0', params: [] };
  return { clause: `${column} IN (${allowed.map(() => '?').join(',')})`, params: allowed };
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
    const id = Number(req.params.id);
    const structure = await get('SELECT * FROM fee_structures WHERE id = ?', [id]);
    if (!structure) throw notFound('Fee structure not found');
    if (!isAdmin(req.user) && structure.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const students = req.body.student_ids?.length
      ? await all(
          `SELECT id FROM students WHERE id IN (${req.body.student_ids.map(() => '?').join(',')}) AND status = 'ACTIVE'`,
          req.body.student_ids
        )
      : await all(`SELECT id FROM students WHERE class_id = ? AND status = 'ACTIVE'`, [structure.class_id]);

    if (!students.length) throw badRequest('No active students matched this fee structure');

    const assigned = await transaction(async () => {
      let count = 0;
      for (const student of students) {
        const existing = await get('SELECT id FROM student_fees WHERE student_id = ? AND fee_structure_id = ?', [
          student.id,
          id,
        ]);
        if (existing) continue;
        await insert('student_fees', {
          campus_id: structure.campus_id,
          student_id: student.id,
          fee_structure_id: id,
          academic_year_id: structure.academic_year_id,
          total_amount: structure.amount,
          discount_amount: req.body.discount_amount || 0,
          concession_reason: req.body.concession_reason,
          due_date: structure.due_date,
          status: 'PENDING',
        });
        count += 1;

        const user = await get('SELECT user_id FROM students WHERE id = ?', [student.id]);
        if (user?.user_id) {
          await notify({
            userId: user.user_id,
            campusId: structure.campus_id,
            type: 'FEE_DUE',
            title: `Fee assigned: ${structure.name}`,
            body: `Amount due ${structure.amount}${structure.due_date ? ` by ${structure.due_date}` : ''}.`,
            link: '/parent/fees',
          });
        }
      }
      return count;
    })();

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
    const studentFee = await get(
      `SELECT sf.*, s.first_name, s.last_name, s.admission_number, s.user_id AS student_user_id,
              fs.name AS fee_name
         FROM student_fees sf
         JOIN students s ON s.id = sf.student_id
         JOIN fee_structures fs ON fs.id = sf.fee_structure_id
        WHERE sf.id = ?`,
      [body.student_fee_id]
    );
    if (!studentFee) throw notFound('Fee record not found');
    if (!isAdmin(req.user) && studentFee.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const payable = studentFee.total_amount - studentFee.discount_amount - studentFee.paid_amount;
    if (payable <= 0) throw badRequest('This fee has already been settled');
    if (body.amount > payable + 0.01) throw badRequest(`The outstanding balance is only ${payable.toFixed(2)}`);

    const result = await transaction(async () => {
      const paymentId = await insert('fee_payments', {
        campus_id: studentFee.campus_id,
        student_fee_id: studentFee.id,
        student_id: studentFee.student_id,
        amount: body.amount,
        payment_date: body.payment_date || new Date().toISOString().slice(0, 10),
        payment_mode: body.payment_mode,
        transaction_ref: body.transaction_ref,
        bank_name: body.bank_name,
        remarks: body.remarks,
        status: 'SUCCESS',
        collected_by: req.user.id,
      });

      const paid = studentFee.paid_amount + body.amount;
      const balance = studentFee.total_amount - studentFee.discount_amount - paid;
      await update('student_fees', studentFee.id, {
        paid_amount: paid,
        status: balance <= 0.01 ? 'PAID' : 'PARTIAL',
      });

      const year = new Date().getFullYear();
      const receiptNumber = (await receiptNumbers(studentFee.campus_id, year)).take();

      const receiptId = await insert('fee_receipts', {
        campus_id: studentFee.campus_id,
        fee_payment_id: paymentId,
        student_id: studentFee.student_id,
        receipt_number: receiptNumber,
        amount: body.amount,
        amount_in_words: amountInWords(body.amount),
        issued_by: req.user.id,
      });

      // Fee income also lands in the income ledger.
      await insert('income', {
        campus_id: studentFee.campus_id,
        category: 'FEES',
        title: `${studentFee.fee_name} — ${studentFee.admission_number}`,
        amount: body.amount,
        income_date: body.payment_date || new Date().toISOString().slice(0, 10),
        payment_mode: body.payment_mode,
        reference: receiptNumber,
        recorded_by: req.user.id,
      });

      return { paymentId, receiptId, receiptNumber, balance };
    })();

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
    const parents = await all(
      `SELECT p.user_id FROM student_parents sp JOIN parents p ON p.id = sp.parent_id
        WHERE sp.student_id = ? AND p.user_id IS NOT NULL`,
      [studentFee.student_id]
    );
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
    const receipt = await get(
      `SELECT fr.*, fp.amount AS payment_amount, fp.payment_mode, fp.payment_date, fp.transaction_ref,
              s.first_name, s.last_name, s.admission_number, s.roll_number,
              c.name AS class_name, sec.name AS section_name,
              fs.name AS fee_name, fc.name AS category_name,
              u.full_name AS issued_by_name,
              sf.total_amount, sf.discount_amount, sf.paid_amount,
              (sf.total_amount - sf.discount_amount - sf.paid_amount) AS balance
         FROM fee_receipts fr
         JOIN fee_payments fp ON fp.id = fr.fee_payment_id
         JOIN student_fees sf ON sf.id = fp.student_fee_id
         JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         JOIN fee_categories fc ON fc.id = fs.fee_category_id
         JOIN students s ON s.id = fr.student_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN users u ON u.id = fr.issued_by
        WHERE fr.id = ?`,
      [Number(req.params.id)]
    );
    if (!receipt) throw notFound('Receipt not found');
    await assertStudentAccess(req.user, receipt.student_id);

    const campus = await get('SELECT name, address, city, state, pincode, phone, email, logo FROM campuses WHERE id = ?', [
      receipt.campus_id,
    ]);
    return ok(res, { receipt, campus });
  })
);

router.get(
  '/receipts',
  requirePermission('payments.view', 'fees.view'),
  asyncHandler(async (req, res) => {
    const scope = await feeScope(req, 'fr.student_id');
    const clauses = [];
    const params = [];
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('fr.campus_id = ?');
      params.push(req.user.campus_id);
    }
    if (scope) {
      clauses.push(scope.clause);
      params.push(...scope.params);
    }
    if (req.query.student_id) {
      clauses.push('fr.student_id = ?');
      params.push(req.query.student_id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await all(
      `SELECT fr.*, s.first_name, s.last_name, s.admission_number, fp.payment_mode, fp.payment_date
         FROM fee_receipts fr
         JOIN students s ON s.id = fr.student_id
         JOIN fee_payments fp ON fp.id = fr.fee_payment_id
         ${where} ORDER BY fr.issued_at DESC LIMIT 200`,
      params
    );
    return ok(res, rows);
  })
);

/** Outstanding balances, with an optional class filter. */
router.get(
  '/pending',
  requirePermission('fees.view'),
  asyncHandler(async (req, res) => {
    const clauses = ['(sf.total_amount - sf.discount_amount - sf.paid_amount) > 0.01'];
    const params = [];
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('sf.campus_id = ?');
      params.push(req.user.campus_id);
    }
    const scope = await feeScope(req);
    if (scope) {
      clauses.push(scope.clause);
      params.push(...scope.params);
    }
    if (req.query.class_id) {
      clauses.push('s.class_id = ?');
      params.push(req.query.class_id);
    }
    if (req.query.overdue === 'true') clauses.push("substr(sf.due_date, 1, 10) < to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')");

    const rows = await all(
      `SELECT sf.id, sf.student_id, sf.total_amount, sf.discount_amount, sf.paid_amount, sf.due_date, sf.status,
              (sf.total_amount - sf.discount_amount - sf.paid_amount) AS balance,
              s.first_name, s.last_name, s.admission_number, s.roll_number, s.phone,
              c.name AS class_name, sec.name AS section_name, fs.name AS fee_name,
              CASE WHEN substr(sf.due_date, 1, 10) < to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD') THEN 1 ELSE 0 END AS is_overdue
         FROM student_fees sf
         JOIN students s ON s.id = sf.student_id
         JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY sf.due_date LIMIT 500`,
      params
    );

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
    const scope = isAdmin(req.user) && !campusId ? '' : ' AND campus_id = ?';
    const p = scope ? [campusId] : [];

    const today = Number(await scalar(`SELECT COALESCE(SUM(amount), 0) AS n FROM fee_payments WHERE payment_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')${scope}`, p));
    const month = Number(
      await scalar(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM fee_payments
          WHERE substr(payment_date, 1, 7) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM')${scope}`,
        p
      )
    );
    const year = Number(
      await scalar(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM fee_payments
          WHERE substr(payment_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope}`,
        p
      )
    );
    const pending = await get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount - discount_amount - paid_amount), 0) AS amount
         FROM student_fees WHERE (total_amount - discount_amount - paid_amount) > 0.01${scope}`,
      p
    );
    const income = Number(
      await scalar(`SELECT COALESCE(SUM(amount), 0) AS n FROM income WHERE substr(income_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope}`, p)
    );
    const expenses = Number(
      await scalar(`SELECT COALESCE(SUM(amount), 0) AS n FROM expenses WHERE substr(expense_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY') AND status = 'APPROVED'${scope}`, p)
    );
    const payrollMonth = Number(
      await scalar(`SELECT COALESCE(SUM(net_salary), 0) AS n FROM payroll WHERE month = CAST(to_char((now() AT TIME ZONE 'UTC'), 'MM') AS INTEGER) AND year = CAST(to_char((now() AT TIME ZONE 'UTC'), 'YYYY') AS INTEGER)${scope}`, p)
    );
    const transportExpense = Number(
      await scalar(
        `SELECT COALESCE((SELECT SUM(total_cost) FROM fuel_records WHERE substr(fuel_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope}), 0)
              + COALESCE((SELECT SUM(cost) FROM vehicle_maintenance WHERE substr(service_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope}), 0) AS n`,
        scope ? [campusId, campusId] : []
      )
    );

    const monthlyTrend = (await all(
      `SELECT substr(payment_date, 1, 7) AS month, SUM(amount) AS collected
         FROM fee_payments WHERE 1 = 1${scope}
        GROUP BY month ORDER BY month DESC LIMIT 12`,
      p
    )).reverse();

    const recent = await all(
      `SELECT fp.id, fp.amount, fp.payment_date, fp.payment_mode, s.first_name, s.last_name,
              s.admission_number, fr.receipt_number
         FROM fee_payments fp
         JOIN students s ON s.id = fp.student_id
         LEFT JOIN fee_receipts fr ON fr.fee_payment_id = fp.id
        WHERE 1 = 1${scope ? ' AND fp.campus_id = ?' : ''}
        ORDER BY fp.created_at DESC LIMIT 10`,
      p
    );

    const byMode = await all(
      `SELECT payment_mode, COUNT(*) AS count, SUM(amount) AS amount FROM fee_payments
        WHERE substr(payment_date, 1, 7) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM')${scope}
        GROUP BY payment_mode`,
      p
    );

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
      const last = await get(
        `SELECT balance_after FROM petty_cash WHERE campus_id = ? ORDER BY id DESC LIMIT 1`,
        [req.user.campus_id]
      );
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

    const structures = req.body.user_ids?.length
      ? await all(
          `SELECT * FROM salary_structures WHERE status = 'ACTIVE' AND user_id IN (${req.body.user_ids
            .map(() => '?')
            .join(',')})`,
          req.body.user_ids
        )
      : await all(`SELECT * FROM salary_structures WHERE status = 'ACTIVE'${campusId ? ' AND campus_id = ?' : ''}`, campusId ? [campusId] : []);

    if (!structures.length) throw badRequest('No active salary structures were found');

    const workingDays = new Date(year, month, 0).getDate();

    // Built once for the whole run rather than per payslip.
    const payslips = await payslipNumbers(year, month);

    const summary = await transaction(async () => {
      let generated = 0;
      let skipped = 0;
      for (const structure of structures) {
        const existing = await get('SELECT id FROM payroll WHERE user_id = ? AND month = ? AND year = ?', [
          structure.user_id,
          month,
          year,
        ]);
        if (existing) {
          skipped += 1;
          continue;
        }

        const faculty = await get('SELECT id FROM faculty WHERE user_id = ?', [structure.user_id]);
        const attendance = faculty
          ? await get(
              `SELECT COUNT(*) AS total,
                      SUM(CASE WHEN status IN ('PRESENT','LATE') THEN 1 ELSE 0 END) AS present,
                      SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absent
                 FROM faculty_attendance
                WHERE faculty_id = ? AND CAST(substr(attendance_date, 6, 2) AS INTEGER) = ?
                  AND CAST(substr(attendance_date, 1, 4) AS INTEGER) = ?`,
              [faculty.id, month, year]
            )
          : null;

        const allowances =
          structure.hra + structure.da + structure.conveyance + structure.medical + structure.other_allowances;
        const lopDays = attendance?.absent ?? 0;
        const perDay = (structure.basic_salary + allowances) / workingDays;
        const lopAmount = Number((perDay * lopDays).toFixed(2));
        const deductions = structure.pf_deduction + structure.tax_deduction + structure.other_deductions + lopAmount;
        const gross = structure.basic_salary + allowances;

        await insert('payroll', {
          campus_id: structure.campus_id,
          user_id: structure.user_id,
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
          processed_by: req.user.id,
        });
        generated += 1;
      }
      return { generated, skipped };
    })();

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
    const id = Number(req.params.id);
    const record = await get('SELECT * FROM payroll WHERE id = ?', [id]);
    if (!record) throw notFound('Payroll record not found');
    if (record.status === 'PAID') throw badRequest('This payslip is already marked paid');

    await update('payroll', id, {
      status: 'PAID',
      payment_date: req.body.payment_date || new Date().toISOString().slice(0, 10),
      payment_mode: req.body.payment_mode,
      remarks: req.body.remarks,
    });

    // Salary paid is an institutional expense.
    await insert('expenses', {
      campus_id: record.campus_id,
      category: 'PAYROLL',
      title: `Salary ${record.month}/${record.year} — ${record.payslip_number}`,
      amount: record.net_salary,
      expense_date: req.body.payment_date || new Date().toISOString().slice(0, 10),
      payment_mode: req.body.payment_mode,
      status: 'APPROVED',
      recorded_by: req.user.id,
      approved_by: req.user.id,
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
    return ok(res, await get('SELECT * FROM payroll WHERE id = ?', [id]));
  })
);

/** Payslip payload — the owner or a payroll manager may fetch it. */
payrollRouter.get(
  '/:id/payslip',
  requirePermission('payroll.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const record = await get(
      `SELECT p.*, u.full_name, u.email, f.faculty_code, f.designation, f.bank_account, f.pan_number,
              d.name AS department_name
         FROM payroll p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN faculty f ON f.user_id = u.id
         LEFT JOIN departments d ON d.id = f.department_id
        WHERE p.id = ?`,
      [id]
    );
    if (!record) throw notFound('Payslip not found');

    const canManage = isAdmin(req.user) || req.permissions.has('payroll.manage') || req.permissions.has('payroll.edit');
    if (!canManage && record.user_id !== req.user.id) throw forbidden('You may only view your own payslip');

    const structure = await get(
      `SELECT * FROM salary_structures WHERE user_id = ? AND status = 'ACTIVE' ORDER BY effective_from DESC LIMIT 1`,
      [record.user_id]
    );
    const campus = await get('SELECT name, address, city, phone, email FROM campuses WHERE id = ?', [record.campus_id]);
    return ok(res, { payslip: record, structure, campus, amountInWords: amountInWords(record.net_salary) });
  })
);
router.use('/payroll', payrollRouter);

export default router;
