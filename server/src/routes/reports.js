import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { ActivityLog, Attendance, Campus, Class, Course, CourseAssignment, Faculty, FeePayment, FeeReceipt, FuelRecord, InventoryItem, Mark, Payroll, Result, Route, Section, Student, StudentFee, TransportAllocation, VehicleMaintenance } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { plain } from '../db/mongo/query.js';
import { asyncHandler, ok } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/ratelimit.js';
import { logActivity } from '../lib/audit.js';
import { isAdmin, accessibleStudentIds, facultyIdOf, isTeacher } from '../lib/scope.js';

const router = Router();

/** Restrict a report to the campus of the caller. */
/** Confine a report to the caller's campus, unless they run the institution. */
function campusFilter(req, field = 'campus_id') {
  if (isAdmin(req.user) && !req.user.campus_id) return {};
  return { [field]: oid(req.user.campus_id) };
}

/**
 * Restrict a pupil-keyed report to the pupils the caller may read.
 *
 * `NONE` is what `1 = 0` said. It has to be `$expr` rather than a condition on
 * a field: strictQuery drops a condition naming a field the collection does
 * not have, and a dropped filter does not mean "no pupils", it means all of
 * them — a report is exactly where that would go unnoticed.
 */
const NONE = { $expr: { $eq: [1, 0] } };

async function studentFilter(req, field = 'student_id') {
  const allowed = await accessibleStudentIds(req.user);
  if (allowed === null) return {};
  if (!allowed.length) return NONE;
  return { [field]: { $in: allowed.map(oid).filter(Boolean) } };
}

/**
 * A date range over a date stored as text.
 *
 * `substr(column, 1, 10) >= from` compared the day. The same holds for a string
 * comparison because the format is fixed and sorts with the days it denotes;
 * the upper bound carries a suffix so "to the 9th" includes the 9th rather
 * than stopping at its first instant.
 */
const dateFilter = (req, field) => {
  const range = {};
  if (req.query.from) range.$gte = String(req.query.from);
  if (req.query.to) range.$lte = `${String(req.query.to)}\uffff`;
  return Object.keys(range).length ? { [field]: range } : {};
};

/** The name a report shows, as the SQL concatenation built it. */
const fullName = (person) =>
  [person?.first_name, person?.last_name].filter(Boolean).join(' ');

/** Rounded the way ROUND(x, 2) was. */
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/**
 * Pupils by id, with their class and section — the join every pupil-keyed
 * report repeats. Fetched once for the ids a report actually returned.
 */
async function pupilsById(ids) {
  const unique = [...new Set(ids.map(String))].map(oid).filter(Boolean);
  if (!unique.length) return new Map();
  const docs = await Student.find({ _id: { $in: unique } })
    .select('admission_number first_name last_name roll_number class_id section_id')
    .populate('class_id', 'name numeric_level')
    .populate('section_id', 'name');
  return new Map(docs.map((d) => [String(d._id), d]));
}

const REPORTS = {
  students: {
    title: 'Student Report',
    permission: 'students.view',
    columns: [
      { key: 'admission_number', label: 'Admission No', width: 16 },
      { key: 'full_name', label: 'Student Name', width: 26 },
      { key: 'board', label: 'Department', width: 12 },
      { key: 'class_name', label: 'Class', width: 12 },
      { key: 'section_name', label: 'Section', width: 10 },
      { key: 'roll_number', label: 'Roll No', width: 10 },
      { key: 'gender', label: 'Gender', width: 10 },
      { key: 'phone', label: 'Phone', width: 14 },
      { key: 'admission_date', label: 'Admitted On', width: 14 },
      { key: 'status', label: 'Status', width: 12 },
    ],
    async run(req) {
      const filter = {
        ...campusFilter(req),
        ...(await studentFilter(req, '_id')),
      };
      if (req.query.status) filter.status = req.query.status;
      if (req.query.board) filter.board = req.query.board;

      const docs = await Student.find(filter)
        .select('admission_number first_name last_name board class_id section_id roll_number gender phone admission_date status')
        .populate('class_id', 'name numeric_level')
        .populate('section_id', 'name');

      const rows = docs
        .map((d) => ({
          admission_number: d.admission_number,
          full_name: fullName(d),
          board: d.board,
          class_name: d.class_id?.name ?? null,
          section_name: d.section_id?.name ?? null,
          roll_number: d.roll_number,
          gender: d.gender,
          phone: d.phone,
          admission_date: d.admission_date,
          status: d.status,
          _level: d.class_id?.numeric_level ?? 0,
        }))
        /*
         * Ordered by class, then section, then roll number *as a number* —
         * the CASE in the SQL cast only the rolls that are digits, so that '10'
         * follows '9' rather than preceding it. A roll that is not a number
         * sorts last, as NULL did.
         */
        .sort((a, b) =>
          a._level - b._level
          || String(a.section_name ?? '').localeCompare(String(b.section_name ?? ''))
          || (Number(a.roll_number) || Infinity) - (Number(b.roll_number) || Infinity))
        .map(({ _level, ...row }) => row);

      return { rows, summary: { 'Total students': rows.length } };
    },
  },

  attendance: {
    title: 'Attendance Report',
    permission: 'attendance.view',
    columns: [
      { key: 'admission_number', label: 'Admission No', width: 16 },
      { key: 'full_name', label: 'Student', width: 26 },
      { key: 'class_name', label: 'Class', width: 12 },
      { key: 'section_name', label: 'Section', width: 10 },
      { key: 'total', label: 'Sessions', width: 10 },
      { key: 'present', label: 'Present', width: 10 },
      { key: 'absent', label: 'Absent', width: 10 },
      { key: 'percentage', label: 'Attendance %', width: 14 },
    ],
    async run(req) {
      const match = {
        ...campusFilter(req),
        ...(await studentFilter(req)),
        ...dateFilter(req, 'attendance_date'),
      };

      // Narrowing by class or section is a property of the pupil, not of the
      // attendance record, so the pupils are resolved first.
      if (req.query.section_id || req.query.class_id) {
        const pupilFilter = {};
        if (req.query.section_id) pupilFilter.section_id = oid(req.query.section_id);
        if (req.query.class_id) pupilFilter.class_id = oid(req.query.class_id);
        const pupils = await Student.find(pupilFilter).select('_id').lean();
        match.student_id = { $in: pupils.map((x) => x._id) };
      }

      const grouped = await Attendance.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$student_id',
            total: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
          },
        },
      ]);

      const pupils = await pupilsById(grouped.map((g) => g._id));
      const rows = grouped
        .map((g) => {
          const pupil = pupils.get(String(g._id));
          return {
            admission_number: pupil?.admission_number ?? null,
            full_name: fullName(pupil),
            class_name: pupil?.class_id?.name ?? null,
            section_name: pupil?.section_id?.name ?? null,
            total: g.total,
            present: g.present,
            absent: g.absent,
            percentage: g.total ? round2((100 * g.present) / g.total) : 0,
          };
        })
        .sort((a, b) => a.percentage - b.percentage);

      const average = rows.length
        ? (rows.reduce((sum, r) => sum + (r.percentage || 0), 0) / rows.length).toFixed(2)
        : 0;
      return { rows, summary: { 'Students covered': rows.length, 'Average attendance': `${average}%` } };
    },
  },

  results: {
    title: 'Examination Result Report',
    permission: 'results.view',
    columns: [
      { key: 'admission_number', label: 'Admission No', width: 16 },
      { key: 'full_name', label: 'Student', width: 26 },
      { key: 'class_name', label: 'Class', width: 12 },
      { key: 'exam_name', label: 'Examination', width: 22 },
      { key: 'obtained_marks', label: 'Obtained', width: 12 },
      { key: 'total_marks', label: 'Total', width: 10 },
      { key: 'percentage', label: 'Percent', width: 10 },
      { key: 'grade', label: 'Grade', width: 8 },
      { key: 'rank_in_class', label: 'Rank', width: 8 },
      { key: 'result_status', label: 'Result', width: 10 },
    ],
    async run(req) {
      const filter = {
        ...campusFilter(req),
        ...(await studentFilter(req)),
      };
      if (req.query.examination_id) filter.examination_id = oid(req.query.examination_id);
      if (req.query.class_id) filter.class_id = oid(req.query.class_id);

      const docs = await Result.find(filter)
        .populate('student_id', 'admission_number first_name last_name')
        .populate('examination_id', 'name')
        .populate('class_id', 'name')
        .sort({ percentage: -1 });

      const rows = docs.map((r) => ({
        admission_number: r.student_id?.admission_number ?? null,
        full_name: fullName(r.student_id),
        class_name: r.class_id?.name ?? null,
        exam_name: r.examination_id?.name ?? null,
        obtained_marks: r.obtained_marks,
        total_marks: r.total_marks,
        percentage: r.percentage,
        grade: r.grade,
        rank_in_class: r.rank_in_class,
        result_status: r.result_status,
      }));

      const passed = rows.filter((r) => r.result_status === 'PASS').length;
      return {
        rows,
        summary: {
          'Results': rows.length,
          'Passed': passed,
          'Failed': rows.length - passed,
          'Pass rate': rows.length ? `${((passed / rows.length) * 100).toFixed(1)}%` : '0%',
        },
      };
    },
  },

  fees: {
    title: 'Fee Collection Report',
    permission: 'fees.view',
    columns: [
      { key: 'admission_number', label: 'Admission No', width: 16 },
      { key: 'full_name', label: 'Student', width: 26 },
      { key: 'class_name', label: 'Class', width: 12 },
      { key: 'fee_name', label: 'Fee Head', width: 22 },
      { key: 'total_amount', label: 'Billed', width: 12 },
      { key: 'discount_amount', label: 'Discount', width: 12 },
      { key: 'paid_amount', label: 'Paid', width: 12 },
      { key: 'balance', label: 'Balance', width: 12 },
      { key: 'due_date', label: 'Due Date', width: 14 },
      { key: 'status', label: 'Status', width: 12 },
    ],
    async run(req) {
      const filter = {
        ...campusFilter(req),
        ...(await studentFilter(req)),
      };
      if (req.query.status) filter.status = req.query.status;

      if (req.query.class_id) {
        const pupils = await Student.find({ class_id: oid(req.query.class_id) }).select('_id').lean();
        filter.student_id = { $in: pupils.map((x) => x._id) };
      }

      /*
       * "Still owing" compares three fields of the same record, which a plain
       * filter cannot do — the 0.01 kept rounding dust from counting as a
       * debt, and it still does.
       */
      if (req.query.pending === 'true') {
        filter.$expr = {
          $gt: [
            { $subtract: [
              { $subtract: [{ $ifNull: ['$total_amount', 0] }, { $ifNull: ['$discount_amount', 0] }] },
              { $ifNull: ['$paid_amount', 0] },
            ] },
            0.01,
          ],
        };
      }

      const docs = await StudentFee.find(filter)
        .populate('student_id', 'admission_number first_name last_name class_id')
        .populate({ path: 'student_id', populate: { path: 'class_id', select: 'name' } })
        .populate('fee_structure_id', 'name');

      const rows = docs.map((f) => ({
        admission_number: f.student_id?.admission_number ?? null,
        full_name: fullName(f.student_id),
        class_name: f.student_id?.class_id?.name ?? null,
        fee_name: f.fee_structure_id?.name ?? null,
        total_amount: f.total_amount,
        discount_amount: f.discount_amount,
        paid_amount: f.paid_amount,
        balance: Number(f.total_amount || 0) - Number(f.discount_amount || 0) - Number(f.paid_amount || 0),
        due_date: f.due_date,
        status: f.status,
      }));

      const billed = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
      const collected = rows.reduce((sum, r) => sum + Number(r.paid_amount || 0), 0);
      const outstanding = rows.reduce((sum, r) => sum + Number(r.balance || 0), 0);
      return {
        rows,
        summary: {
          'Fee records': rows.length,
          'Billed': billed.toFixed(2),
          'Collected': collected.toFixed(2),
          'Outstanding': outstanding.toFixed(2),
        },
      };
    },
  },

  payments: {
    title: 'Payment Transaction Report',
    permission: 'payments.view',
    columns: [
      { key: 'receipt_number', label: 'Receipt No', width: 18 },
      { key: 'payment_date', label: 'Date', width: 14 },
      { key: 'admission_number', label: 'Admission No', width: 16 },
      { key: 'full_name', label: 'Student', width: 24 },
      { key: 'amount', label: 'Amount', width: 12 },
      { key: 'payment_mode', label: 'Mode', width: 12 },
      { key: 'collected_by_name', label: 'Collected By', width: 20 },
    ],
    async run(req) {
      const filter = {
        ...campusFilter(req),
        ...(await studentFilter(req)),
        ...dateFilter(req, 'payment_date'),
      };

      const docs = await FeePayment.find(filter)
        .populate('student_id', 'admission_number first_name last_name')
        .populate('collected_by', 'full_name')
        .sort({ payment_date: -1 });

      // The receipt is a separate record pointing back at the payment, which
      // is the direction the LEFT JOIN read it in.
      const receipts = docs.length
        ? await FeeReceipt.find({ fee_payment_id: { $in: docs.map((d) => d._id) } })
          .select('fee_payment_id receipt_number').lean()
        : [];
      const receiptFor = new Map(receipts.map((r) => [String(r.fee_payment_id), r.receipt_number]));

      const rows = docs.map((fp) => ({
        receipt_number: receiptFor.get(String(fp._id)) ?? null,
        payment_date: fp.payment_date,
        admission_number: fp.student_id?.admission_number ?? null,
        full_name: fullName(fp.student_id),
        amount: fp.amount,
        payment_mode: fp.payment_mode,
        collected_by_name: fp.collected_by?.full_name ?? null,
      }));

      const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      return { rows, summary: { 'Transactions': rows.length, 'Total collected': total.toFixed(2) } };
    },
  },

  faculty: {
    title: 'Faculty Report',
    permission: 'faculty.view',
    columns: [
      { key: 'faculty_code', label: 'Faculty ID', width: 14 },
      { key: 'full_name', label: 'Name', width: 26 },
      { key: 'staff_type', label: 'Category', width: 14 },
      { key: 'designation', label: 'Designation', width: 20 },
      { key: 'department_name', label: 'Department', width: 20 },
      { key: 'qualification', label: 'Qualification', width: 20 },
      { key: 'assigned_courses', label: 'Courses', width: 10 },
      { key: 'date_of_joining', label: 'Joined', width: 14 },
      { key: 'status', label: 'Status', width: 12 },
    ],
    async run(req) {
      const filter = campusFilter(req);
      if (req.query.staff_type) filter.staff_type = req.query.staff_type;

      const docs = await Faculty.find(filter)
        .populate('user_id', 'full_name')
        .populate('department_id', 'name');

      // The assigned-course count was a correlated subquery: one grouped
      // query here instead of one per member of staff.
      const assignments = await CourseAssignment.aggregate([
        { $match: { faculty_id: { $in: docs.map((d) => d._id) }, status: 'ACTIVE' } },
        { $group: { _id: '$faculty_id', n: { $sum: 1 } } },
      ]);
      const assignedTo = new Map(assignments.map((a) => [String(a._id), a.n]));

      const rows = docs
        .map((f) => ({
          faculty_code: f.faculty_code,
          full_name: f.user_id?.full_name ?? fullName(f),
          staff_type: f.staff_type,
          designation: f.designation,
          department_name: f.department_id?.name ?? null,
          qualification: f.qualification,
          date_of_joining: f.date_of_joining,
          status: f.status,
          assigned_courses: assignedTo.get(String(f._id)) ?? 0,
        }))
        .sort((a, b) =>
          String(a.staff_type ?? '').localeCompare(String(b.staff_type ?? ''))
          || String(a.full_name ?? '').localeCompare(String(b.full_name ?? '')));

      return { rows, summary: { 'Staff': rows.length } };
    },
  },

  payroll: {
    title: 'Payroll Report',
    permission: 'payroll.view',
    columns: [
      { key: 'payslip_number', label: 'Payslip No', width: 20 },
      { key: 'full_name', label: 'Employee', width: 26 },
      { key: 'month', label: 'Month', width: 8 },
      { key: 'year', label: 'Year', width: 8 },
      { key: 'gross_salary', label: 'Gross', width: 12 },
      { key: 'total_deductions', label: 'Deductions', width: 12 },
      { key: 'net_salary', label: 'Net Pay', width: 12 },
      { key: 'status', label: 'Status', width: 12 },
    ],
    async run(req) {
      const filter = campusFilter(req);
      if (req.query.month) filter.month = Number(req.query.month);
      if (req.query.year) filter.year = Number(req.query.year);

      // Without payroll.manage a user only ever exports their own payslips.
      if (!isAdmin(req.user) && !req.permissions.has('payroll.manage') && !req.permissions.has('payroll.edit')) {
        filter.user_id = oid(req.user.id);
      }

      const docs = await Payroll.find(filter)
        .populate('user_id', 'full_name')
        .sort({ year: -1, month: -1 });

      const rows = docs
        .map((p2) => ({
          payslip_number: p2.payslip_number,
          full_name: p2.user_id?.full_name ?? null,
          month: p2.month,
          year: p2.year,
          gross_salary: p2.gross_salary,
          total_deductions: p2.total_deductions,
          net_salary: p2.net_salary,
          status: p2.status,
        }))
        // Year and month are sorted by the database; the name breaks ties
        // within a month, which is what the third ORDER BY term did.
        .sort((a, b) => (b.year - a.year) || (b.month - a.month)
          || String(a.full_name ?? '').localeCompare(String(b.full_name ?? '')));

      const net = rows.reduce((sum, r) => sum + Number(r.net_salary || 0), 0);
      return { rows, summary: { 'Payslips': rows.length, 'Total net pay': net.toFixed(2) } };
    },
  },

  transport: {
    title: 'Transport Report',
    permission: 'transport.view',
    columns: [
      { key: 'route_code', label: 'Route Code', width: 14 },
      { key: 'route_name', label: 'Route', width: 24 },
      { key: 'vehicle_number', label: 'Vehicle', width: 16 },
      { key: 'driver_name', label: 'Driver', width: 20 },
      { key: 'capacity', label: 'Capacity', width: 10 },
      { key: 'allocated', label: 'Allocated', width: 10 },
      { key: 'fare', label: 'Fare', width: 10 },
      { key: 'fuel_cost', label: 'Fuel Cost', width: 12 },
      { key: 'maintenance_cost', label: 'Maintenance', width: 14 },
    ],
    async run(req) {
      const filter = campusFilter(req);
      const docs = await Route.find(filter)
        .populate('vehicle_id', 'vehicle_number capacity')
        .populate('driver_id', 'name')
        .sort({ name: 1 });

      const vehicleIds = docs.map((r) => r.vehicle_id?._id).filter(Boolean);
      const sumBy = async (Model, field) => {
        const rows = await Model.aggregate([
          { $match: { vehicle_id: { $in: vehicleIds } } },
          { $group: { _id: '$vehicle_id', n: { $sum: { $ifNull: [`$${field}`, 0] } } } },
        ]);
        return new Map(rows.map((r) => [String(r._id), r.n]));
      };
      const [allocations, fuel, maintenance] = await Promise.all([
        TransportAllocation.aggregate([
          { $match: { route_id: { $in: docs.map((r) => r._id) }, status: 'ACTIVE' } },
          { $group: { _id: '$route_id', n: { $sum: 1 } } },
        ]).then((rows) => new Map(rows.map((r) => [String(r._id), r.n]))),
        sumBy(FuelRecord, 'total_cost'),
        sumBy(VehicleMaintenance, 'cost'),
      ]);

      const rows = docs.map((r) => ({
        route_code: r.route_code,
        route_name: r.name,
        vehicle_number: r.vehicle_id?.vehicle_number ?? null,
        driver_name: r.driver_id?.name ?? null,
        capacity: r.vehicle_id?.capacity ?? null,
        fare: r.fare,
        allocated: allocations.get(String(r._id)) ?? 0,
        fuel_cost: fuel.get(String(r.vehicle_id?._id)) ?? 0,
        maintenance_cost: maintenance.get(String(r.vehicle_id?._id)) ?? 0,
      }));

      return {
        rows,
        summary: {
          'Routes': rows.length,
          'Students allocated': rows.reduce((s2, r) => s2 + Number(r.allocated || 0), 0),
          'Running cost': rows
            .reduce((s2, r) => s2 + Number(r.fuel_cost || 0) + Number(r.maintenance_cost || 0), 0)
            .toFixed(2),
        },
      };
    },
  },

  inventory: {
    title: 'Inventory Report',
    permission: 'inventory.view',
    columns: [
      { key: 'item_code', label: 'Item Code', width: 14 },
      { key: 'name', label: 'Item', width: 26 },
      { key: 'category_name', label: 'Category', width: 18 },
      { key: 'quantity', label: 'Qty', width: 8 },
      { key: 'unit', label: 'Unit', width: 8 },
      { key: 'location', label: 'Location', width: 18 },
      { key: 'condition_status', label: 'Condition', width: 12 },
      { key: 'unit_cost', label: 'Unit Cost', width: 12 },
      { key: 'total_value', label: 'Value', width: 12 },
    ],
    async run(req) {
      const docs = await InventoryItem.find(campusFilter(req))
        .populate('category_id', 'name');

      const rows = docs
        .map((i) => ({
          item_code: i.item_code,
          name: i.name,
          category_name: i.category_id?.name ?? null,
          quantity: i.quantity,
          unit: i.unit,
          location: i.location,
          condition_status: i.condition_status,
          unit_cost: i.unit_cost,
          total_value: Number(i.quantity || 0) * Number(i.unit_cost || 0),
        }))
        .sort((a, b) =>
          String(a.category_name ?? '').localeCompare(String(b.category_name ?? ''))
          || String(a.name ?? '').localeCompare(String(b.name ?? '')));

      return {
        rows,
        summary: {
          'Items': rows.length,
          'Total value': rows.reduce((s2, r) => s2 + Number(r.total_value || 0), 0).toFixed(2),
        },
      };
    },
  },

  administrative: {
    title: 'Administrative Activity Report',
    permission: 'audit.view',
    columns: [
      { key: 'created_at', label: 'Timestamp', width: 20 },
      { key: 'user_name', label: 'User', width: 22 },
      { key: 'role_code', label: 'Role', width: 16 },
      { key: 'action', label: 'Action', width: 18 },
      { key: 'module', label: 'Module', width: 16 },
      { key: 'description', label: 'Description', width: 46 },
    ],
    async run(req) {
      const rows = plain(
        await ActivityLog.find(dateFilter(req, 'created_at'))
          .select('created_at user_name role_code action module description')
          .sort({ created_at: -1 })
          .limit(5000)
      ).map(({ id, ...row }) => row);

      return { rows, summary: { 'Entries': rows.length } };
    },
  },

  academic: {
    title: 'Academic Performance Report',
    permission: 'reports.view',
    columns: [
      { key: 'class_name', label: 'Class', width: 14 },
      { key: 'section_name', label: 'Section', width: 12 },
      { key: 'subject_name', label: 'Subject', width: 22 },
      { key: 'students', label: 'Students', width: 10 },
      { key: 'average_marks', label: 'Average', width: 12 },
      { key: 'highest', label: 'Highest', width: 10 },
      { key: 'lowest', label: 'Lowest', width: 10 },
      { key: 'pass_count', label: 'Passed', width: 10 },
    ],
    async run(req) {
      const match = { ...campusFilter(req), status: 'APPROVED' };
      if (req.query.examination_id) match.examination_id = oid(req.query.examination_id);

      // A teacher only sees the courses assigned to them.
      if (isTeacher(req.user)) {
        const facultyId = await facultyIdOf(req.user);
        const assigned = await CourseAssignment.find({ faculty_id: oid(facultyId), status: 'ACTIVE' })
          .select('course_id').lean();
        match.course_id = { $in: assigned.map((a) => a.course_id).filter(Boolean) };
      }

      /*
       * Grouped by course and by the pupil's section, which is why the pupil
       * is brought in: the section is theirs, not the mark's. The pass count
       * compares each mark with its own subject's pass mark, so that comes in
       * too.
       */
      const grouped = await Mark.aggregate([
        { $match: match },
        { $lookup: { from: 'students', localField: 'student_id', foreignField: '_id', as: 'pupil' } },
        { $unwind: '$pupil' },
        { $lookup: { from: 'exam_subjects', localField: 'exam_subject_id', foreignField: '_id', as: 'subject' } },
        { $unwind: '$subject' },
        {
          $group: {
            _id: { course_id: '$course_id', section_id: '$pupil.section_id', class_id: '$pupil.class_id' },
            students: { $sum: 1 },
            average_marks: { $avg: '$marks_obtained' },
            highest: { $max: '$marks_obtained' },
            lowest: { $min: '$marks_obtained' },
            pass_count: {
              $sum: { $cond: [{ $gte: ['$marks_obtained', '$subject.pass_marks'] }, 1, 0] },
            },
          },
        },
      ]);

      const courses = await Course.find({ _id: { $in: grouped.map((g) => g._id.course_id) } })
        .select('subject_id').populate('subject_id', 'name');
      const subjectFor = new Map(courses.map((c) => [String(c._id), c.subject_id?.name ?? null]));

      const classes = await Class.find({ _id: { $in: grouped.map((g) => g._id.class_id).filter(Boolean) } })
        .select('name numeric_level').lean();
      const classFor = new Map(classes.map((c) => [String(c._id), c]));

      const sections = await Section.find({ _id: { $in: grouped.map((g) => g._id.section_id).filter(Boolean) } })
        .select('name').lean();
      const sectionFor = new Map(sections.map((x) => [String(x._id), x.name]));

      const rows = grouped
        .map((g) => ({
          class_name: classFor.get(String(g._id.class_id))?.name ?? null,
          section_name: sectionFor.get(String(g._id.section_id)) ?? null,
          subject_name: subjectFor.get(String(g._id.course_id)) ?? null,
          students: g.students,
          average_marks: round2(g.average_marks),
          highest: g.highest,
          lowest: g.lowest,
          pass_count: g.pass_count,
          _level: classFor.get(String(g._id.class_id))?.numeric_level ?? 0,
        }))
        .sort((a, b) =>
          a._level - b._level
          || String(a.section_name ?? '').localeCompare(String(b.section_name ?? ''))
          || String(a.subject_name ?? '').localeCompare(String(b.subject_name ?? '')))
        .map(({ _level, ...row }) => row);

      return { rows, summary: { 'Course groups': rows.length } };
    },
  },
};

/** The list of reports this particular user may run. */
router.get(
  '/',
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const available = Object.entries(REPORTS)
      .filter(([, def]) => req.permissions.has(def.permission))
      .map(([key, def]) => ({
        key,
        title: def.title,
        permission: def.permission,
        columns: def.columns.map((c) => ({ key: c.key, label: c.label })),
      }));
    return ok(res, available);
  })
);

/**
 * Run a report. `format` selects the representation:
 * json (default), csv, xlsx or pdf.
 */
router.get(
  '/:key',
  requirePermission('reports.view'),
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const definition = REPORTS[req.params.key];
    if (!definition) throw notFound('Unknown report');
    if (!req.permissions.has(definition.permission)) {
      throw forbidden(`You do not have permission to run the ${definition.title}`);
    }

    const format = String(req.query.format || 'json').toLowerCase();
    if (!['json', 'csv', 'xlsx', 'pdf'].includes(format)) throw badRequest('Unsupported format');
    if (format !== 'json' && !req.permissions.has('reports.export')) {
      throw forbidden('You do not have permission to export reports');
    }

    const { rows, summary } = await definition.run(req);
    const campus = req.user.campus_id
      ? await Campus.findById(oid(req.user.campus_id)).select('name address city').lean()
      : null;
    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

    await logActivity({
      req,
      action: 'EXPORT',
      module: 'reports',
      entityType: 'Report',
      description: `Generated ${definition.title} (${format.toUpperCase()}, ${rows.length} rows)`,
      newValues: { report: req.params.key, format, filters: req.query },
    });

    const filename = `${req.params.key}-report-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'json') {
      return ok(res, { title: definition.title, columns: definition.columns, rows, summary, generatedAt, campus });
    }

    if (format === 'csv') {
      const escape = (value) => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const lines = [
        definition.columns.map((c) => escape(c.label)).join(','),
        ...rows.map((row) => definition.columns.map((c) => escape(row[c.key])).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send('﻿' + lines.join('\r\n'));
    }

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Vignan ERP';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet(definition.title.slice(0, 30));

      sheet.mergeCells(1, 1, 1, definition.columns.length);
      const titleCell = sheet.getCell(1, 1);
      titleCell.value = `${campus?.name || 'Vignan Educational Institutions'} — ${definition.title}`;
      titleCell.font = { size: 14, bold: true, color: { argb: 'FF12305A' } };
      titleCell.alignment = { horizontal: 'center' };

      sheet.mergeCells(2, 1, 2, definition.columns.length);
      const metaCell = sheet.getCell(2, 1);
      metaCell.value = `Generated ${generatedAt} · ${rows.length} record(s)`;
      metaCell.font = { size: 9, color: { argb: 'FF64748B' } };
      metaCell.alignment = { horizontal: 'center' };

      const headerRow = sheet.getRow(4);
      definition.columns.forEach((column, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = column.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12305A' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        sheet.getColumn(index + 1).width = column.width || 18;
      });
      headerRow.commit();

      rows.forEach((row, rowIndex) => {
        const excelRow = sheet.getRow(5 + rowIndex);
        definition.columns.forEach((column, index) => {
          excelRow.getCell(index + 1).value = row[column.key] ?? '';
        });
        if (rowIndex % 2 === 1) {
          excelRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          });
        }
        excelRow.commit();
      });

      if (summary) {
        let summaryRow = 6 + rows.length;
        for (const [label, value] of Object.entries(summary)) {
          sheet.getCell(summaryRow, 1).value = label;
          sheet.getCell(summaryRow, 1).font = { bold: true };
          sheet.getCell(summaryRow, 2).value = value;
          summaryRow += 1;
        }
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    // ------------------------------------------------------------ PDF
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 64;
    const totalWidth = definition.columns.reduce((sum, c) => sum + (c.width || 18), 0);
    const widths = definition.columns.map((c) => ((c.width || 18) / totalWidth) * pageWidth);

    const drawHeader = () => {
      doc.rect(32, 28, pageWidth, 46).fill('#12305A');
      doc.fillColor('#FFFFFF').fontSize(15).text(campus?.name || 'Vignan Educational Institutions', 42, 36);
      doc.fontSize(10).fillColor('#C7D6EC').text(`${definition.title} · generated ${generatedAt}`, 42, 56);
      doc.fillColor('#0F172A');
    };

    const drawTableHeader = (y) => {
      doc.rect(32, y, pageWidth, 20).fill('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(8);
      let x = 34;
      definition.columns.forEach((column, index) => {
        doc.text(column.label, x, y + 6, { width: widths[index] - 4, ellipsis: true });
        x += widths[index];
      });
      return y + 20;
    };

    drawHeader();
    let y = drawTableHeader(86);

    doc.fontSize(8);
    for (const row of rows) {
      if (y > doc.page.height - 60) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
        drawHeader();
        y = drawTableHeader(86);
        doc.fontSize(8);
      }
      let x = 34;
      definition.columns.forEach((column, index) => {
        const value = row[column.key];
        doc
          .fillColor('#1E293B')
          .text(value === null || value === undefined ? '' : String(value), x, y + 5, {
            width: widths[index] - 4,
            ellipsis: true,
            lineBreak: false,
          });
        x += widths[index];
      });
      y += 17;
      doc.moveTo(32, y).lineTo(32 + pageWidth, y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    }

    if (summary) {
      if (y > doc.page.height - 110) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
        drawHeader();
        y = 86;
      }
      y += 12;
      doc.fontSize(10).fillColor('#12305A').text('Summary', 34, y);
      y += 16;
      doc.fontSize(9).fillColor('#334155');
      for (const [label, value] of Object.entries(summary)) {
        doc.text(`${label}: ${value}`, 34, y);
        y += 13;
      }
    }

    doc.fontSize(7).fillColor('#94A3B8').text(
      `Vignan ERP · confidential · ${rows.length} record(s)`,
      32,
      doc.page.height - 40,
      { width: pageWidth, align: 'center' }
    );

    doc.end();
    return undefined;
  })
);

export default router;
