import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { all, get, scalar } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/ratelimit.js';
import { logActivity } from '../lib/audit.js';
import { isAdmin, accessibleStudentIds, facultyIdOf, isTeacher } from '../lib/scope.js';

const router = Router();

/** Restrict a report to the campus of the caller. */
function campusClause(req, column) {
  if (isAdmin(req.user) && !req.user.campus_id) return { clause: '1 = 1', params: [] };
  return { clause: `${column} = ?`, params: [req.user.campus_id] };
}

/** Restrict a student-keyed report to the students the caller may read. */
async function studentClause(req, column) {
  const allowed = await accessibleStudentIds(req.user);
  if (allowed === null) return { clause: '1 = 1', params: [] };
  if (!allowed.length) return { clause: '1 = 0', params: [] };
  return { clause: `${column} IN (${allowed.map(() => '?').join(',')})`, params: allowed };
}

const dateRange = (req, column) => {
  const clauses = [];
  const params = [];
  if (req.query.from) {
    clauses.push(`substr(${column}, 1, 10) >= ?`);
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push(`substr(${column}, 1, 10) <= ?`);
    params.push(req.query.to);
  }
  return { clause: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
};

/**
 * Report catalogue. Each entry declares the permission it needs and returns
 * { columns, rows, summary } so every output format is driven by one query.
 */
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
      const campus = campusClause(req, 's.campus_id');
      const scope = await studentClause(req, 's.id');
      const filters = [];
      const params = [...campus.params, ...scope.params];
      if (req.query.class_id) {
        filters.push('s.class_id = ?');
        params.push(req.query.class_id);
      }
      if (req.query.section_id) {
        filters.push('s.section_id = ?');
        params.push(req.query.section_id);
      }
      if (req.query.status) {
        filters.push('s.status = ?');
        params.push(req.query.status);
      }
      if (req.query.board) {
        filters.push('s.board = ?');
        params.push(req.query.board);
      }
      const rows = await all(
        `SELECT s.admission_number, (s.first_name || ' ' || COALESCE(s.last_name,'')) AS full_name,
                s.board, c.name AS class_name, sec.name AS section_name, s.roll_number, s.gender, s.phone,
                s.admission_date, s.status
           FROM students s
           LEFT JOIN classes c ON c.id = s.class_id
           LEFT JOIN sections sec ON sec.id = s.section_id
          WHERE ${campus.clause} AND ${scope.clause}${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          ORDER BY c.numeric_level, sec.name, (CASE WHEN s.roll_number ~ '^[0-9]+$' THEN s.roll_number::int ELSE NULL END)`,
        params
      );
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
      const campus = campusClause(req, 'a.campus_id');
      const scope = await studentClause(req, 'a.student_id');
      const range = dateRange(req, 'a.attendance_date');
      const params = [...campus.params, ...scope.params, ...range.params];
      const filters = [];
      if (req.query.section_id) {
        filters.push('s.section_id = ?');
        params.push(req.query.section_id);
      }
      if (req.query.class_id) {
        filters.push('s.class_id = ?');
        params.push(req.query.class_id);
      }
      const rows = await all(
        `SELECT s.admission_number, (s.first_name || ' ' || COALESCE(s.last_name,'')) AS full_name,
                c.name AS class_name, sec.name AS section_name,
                COUNT(*) AS total,
                SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN a.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent,
                ROUND(100.0 * SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) / COUNT(*), 2) AS percentage
           FROM attendance a
           JOIN students s ON s.id = a.student_id
           LEFT JOIN classes c ON c.id = s.class_id
           LEFT JOIN sections sec ON sec.id = s.section_id
          WHERE ${campus.clause} AND ${scope.clause} AND ${range.clause}${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          GROUP BY s.id, c.id, sec.id ORDER BY percentage`,
        params
      );
      const average = rows.length ? (rows.reduce((sum, r) => sum + (r.percentage || 0), 0) / rows.length).toFixed(2) : 0;
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
      const campus = campusClause(req, 'r.campus_id');
      const scope = await studentClause(req, 'r.student_id');
      const params = [...campus.params, ...scope.params];
      const filters = [];
      if (req.query.examination_id) {
        filters.push('r.examination_id = ?');
        params.push(req.query.examination_id);
      }
      if (req.query.class_id) {
        filters.push('r.class_id = ?');
        params.push(req.query.class_id);
      }
      const rows = await all(
        `SELECT s.admission_number, (s.first_name || ' ' || COALESCE(s.last_name,'')) AS full_name,
                c.name AS class_name, e.name AS exam_name, r.obtained_marks, r.total_marks,
                r.percentage, r.grade, r.rank_in_class, r.result_status
           FROM results r
           JOIN students s ON s.id = r.student_id
           JOIN examinations e ON e.id = r.examination_id
           LEFT JOIN classes c ON c.id = r.class_id
          WHERE ${campus.clause} AND ${scope.clause}${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          ORDER BY r.percentage DESC`,
        params
      );
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
      const campus = campusClause(req, 'sf.campus_id');
      const scope = await studentClause(req, 'sf.student_id');
      const params = [...campus.params, ...scope.params];
      const filters = [];
      if (req.query.status) {
        filters.push('sf.status = ?');
        params.push(req.query.status);
      }
      if (req.query.class_id) {
        filters.push('s.class_id = ?');
        params.push(req.query.class_id);
      }
      if (req.query.pending === 'true') filters.push('(sf.total_amount - sf.discount_amount - sf.paid_amount) > 0.01');

      const rows = await all(
        `SELECT s.admission_number, (s.first_name || ' ' || COALESCE(s.last_name,'')) AS full_name,
                c.name AS class_name, fs.name AS fee_name, sf.total_amount, sf.discount_amount,
                sf.paid_amount, (sf.total_amount - sf.discount_amount - sf.paid_amount) AS balance,
                sf.due_date, sf.status
           FROM student_fees sf
           JOIN students s ON s.id = sf.student_id
           JOIN fee_structures fs ON fs.id = sf.fee_structure_id
           LEFT JOIN classes c ON c.id = s.class_id
          WHERE ${campus.clause} AND ${scope.clause}${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          ORDER BY sf.due_date`,
        params
      );
      const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
      return {
        rows,
        summary: {
          'Records': rows.length,
          'Total billed': sum('total_amount').toFixed(2),
          'Total collected': sum('paid_amount').toFixed(2),
          'Outstanding': sum('balance').toFixed(2),
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
      const campus = campusClause(req, 'fp.campus_id');
      const scope = await studentClause(req, 'fp.student_id');
      const range = dateRange(req, 'fp.payment_date');
      const rows = await all(
        `SELECT fr.receipt_number, fp.payment_date, s.admission_number,
                (s.first_name || ' ' || COALESCE(s.last_name,'')) AS full_name,
                fp.amount, fp.payment_mode, u.full_name AS collected_by_name
           FROM fee_payments fp
           JOIN students s ON s.id = fp.student_id
           LEFT JOIN fee_receipts fr ON fr.fee_payment_id = fp.id
           LEFT JOIN users u ON u.id = fp.collected_by
          WHERE ${campus.clause} AND ${scope.clause} AND ${range.clause}
          ORDER BY fp.payment_date DESC`,
        [...campus.params, ...scope.params, ...range.params]
      );
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
      const campus = campusClause(req, 'f.campus_id');
      const params = [...campus.params];
      const filters = [];
      if (req.query.staff_type) {
        filters.push('f.staff_type = ?');
        params.push(req.query.staff_type);
      }
      const rows = await all(
        `SELECT f.faculty_code, u.full_name, f.staff_type, f.designation, d.name AS department_name,
                f.qualification, f.date_of_joining, f.status,
                (SELECT COUNT(*) FROM course_assignments ca WHERE ca.faculty_id = f.id AND ca.status = 'ACTIVE') AS assigned_courses
           FROM faculty f
           JOIN users u ON u.id = f.user_id
           LEFT JOIN departments d ON d.id = f.department_id
          WHERE ${campus.clause}${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          ORDER BY f.staff_type, u.full_name`,
        params
      );
      return {
        rows,
        summary: {
          'Total faculty': rows.length,
          'Teaching staff': rows.filter((r) => r.staff_type === 'TEACHING').length,
          'Financial staff': rows.filter((r) => r.staff_type === 'FINANCIAL').length,
        },
      };
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
      const campus = campusClause(req, 'p.campus_id');
      const params = [...campus.params];
      const filters = [];
      if (req.query.month) {
        filters.push('p.month = ?');
        params.push(req.query.month);
      }
      if (req.query.year) {
        filters.push('p.year = ?');
        params.push(req.query.year);
      }
      // Without payroll.manage a user only ever exports their own payslips.
      if (!isAdmin(req.user) && !req.permissions.has('payroll.manage') && !req.permissions.has('payroll.edit')) {
        filters.push('p.user_id = ?');
        params.push(req.user.id);
      }
      const rows = await all(
        `SELECT p.payslip_number, u.full_name, p.month, p.year, p.gross_salary, p.total_deductions,
                p.net_salary, p.status
           FROM payroll p JOIN users u ON u.id = p.user_id
          WHERE ${campus.clause}${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          ORDER BY p.year DESC, p.month DESC, u.full_name`,
        params
      );
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
      const campus = campusClause(req, 'r.campus_id');
      const rows = await all(
        `SELECT r.route_code, r.name AS route_name, v.vehicle_number, d.name AS driver_name,
                v.capacity, r.fare,
                (SELECT COUNT(*) FROM transport_allocations ta WHERE ta.route_id = r.id AND ta.status = 'ACTIVE') AS allocated,
                (SELECT COALESCE(SUM(fr.total_cost),0) FROM fuel_records fr WHERE fr.vehicle_id = v.id) AS fuel_cost,
                (SELECT COALESCE(SUM(vm.cost),0) FROM vehicle_maintenance vm WHERE vm.vehicle_id = v.id) AS maintenance_cost
           FROM routes r
           LEFT JOIN vehicles v ON v.id = r.vehicle_id
           LEFT JOIN drivers d ON d.id = r.driver_id
          WHERE ${campus.clause} ORDER BY r.name`,
        campus.params
      );
      return {
        rows,
        summary: {
          'Routes': rows.length,
          'Students allocated': rows.reduce((s, r) => s + Number(r.allocated || 0), 0),
          'Running cost': rows.reduce((s, r) => s + Number(r.fuel_cost || 0) + Number(r.maintenance_cost || 0), 0).toFixed(2),
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
      const campus = campusClause(req, 'i.campus_id');
      const rows = await all(
        `SELECT i.item_code, i.name, ic.name AS category_name, i.quantity, i.unit, i.location,
                i.condition_status, i.unit_cost, (i.quantity * i.unit_cost) AS total_value
           FROM inventory_items i JOIN inventory_categories ic ON ic.id = i.category_id
          WHERE ${campus.clause} ORDER BY ic.name, i.name`,
        campus.params
      );
      return {
        rows,
        summary: {
          'Items': rows.length,
          'Total value': rows.reduce((s, r) => s + Number(r.total_value || 0), 0).toFixed(2),
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
      const range = dateRange(req, 'created_at');
      const rows = await all(
        `SELECT created_at, user_name, role_code, action, module, description
           FROM activity_logs WHERE ${range.clause} ORDER BY created_at DESC LIMIT 5000`,
        range.params
      );
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
      const campus = campusClause(req, 'm.campus_id');
      const params = [...campus.params];
      const filters = [];
      if (req.query.examination_id) {
        filters.push('m.examination_id = ?');
        params.push(req.query.examination_id);
      }
      // A teacher only sees the courses assigned to them.
      if (isTeacher(req.user)) {
        const facultyId = await facultyIdOf(req.user);
        filters.push(`m.course_id IN (SELECT course_id FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE')`);
        params.push(facultyId ?? 0);
      }
      const rows = await all(
        `SELECT c.name AS class_name, sec.name AS section_name, sub.name AS subject_name,
                COUNT(m.id) AS students,
                ROUND(AVG(m.marks_obtained), 2) AS average_marks,
                MAX(m.marks_obtained) AS highest,
                MIN(m.marks_obtained) AS lowest,
                SUM(CASE WHEN m.marks_obtained >= es.pass_marks THEN 1 ELSE 0 END) AS pass_count
           FROM marks m
           JOIN exam_subjects es ON es.id = m.exam_subject_id
           JOIN courses co ON co.id = m.course_id
           JOIN subjects sub ON sub.id = co.subject_id
           JOIN students s ON s.id = m.student_id
           LEFT JOIN classes c ON c.id = s.class_id
           LEFT JOIN sections sec ON sec.id = s.section_id
          WHERE ${campus.clause} AND m.status = 'APPROVED'${filters.length ? ' AND ' + filters.join(' AND ') : ''}
          GROUP BY co.id, sec.id, sub.id, c.id ORDER BY c.numeric_level, sec.name, sub.name`,
        params
      );
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
    const campus = req.user.campus_id ? await get('SELECT name, address, city FROM campuses WHERE id = ?', [req.user.campus_id]) : null;
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
