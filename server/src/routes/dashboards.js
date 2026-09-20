import { Router } from 'express';
import { all, get, scalar } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { forbidden, badRequest } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { ROLES } from '../lib/permissions.js';
import {
  isAdmin, facultyIdOf, studentIdOf, childrenOf, parentOwnsStudent,
} from '../lib/scope.js';

const router = Router();

const today = () => new Date().toISOString().slice(0, 10);
const num = (value) => Number(value || 0);
const pct = (part, total) => (total ? Number(((part / total) * 100).toFixed(1)) : 0);

/** Campus filter fragment shared across dashboards. */
function campusFilter(req, column = 'campus_id') {
  if (isAdmin(req.user) && !req.user.campus_id) return { clause: '', params: [] };
  return { clause: ` AND ${column} = ?`, params: [req.user.campus_id] };
}

/**
 * The department an Admin or Administrator is working in, if any.
 * Absent means the whole school, which is what both roles see by default.
 */
function selectedBoard(req) {
  const board = String(req.query.board || '').toUpperCase();
  return board === 'STATE' || board === 'CBSE' ? board : null;
}

/** ` AND <column> = ?` for a board-carrying table, or nothing. */
function boardFilter(req, column = 'board') {
  const board = selectedBoard(req);
  return board ? { clause: ` AND ${column} = ?`, params: [board] } : { clause: '', params: [] };
}

// =====================================================================
// ADMIN — complete software overview
// =====================================================================
router.get(
  '/admin',
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { clause, params } = campusFilter(req);
    const board = boardFilter(req);
    const w = (sql) => sql.replace('{campus}', clause);

    // Student, class and course counts narrow to the working department;
    // staff and campus-wide totals stay whole-school.
    const wb = (sql) => sql.replace('{campus}', clause).replace('{board}', board.clause);
    const pb = [...params, ...board.params];

    const counts = {
      administrators: num(await scalar(w(`SELECT COUNT(*) AS n FROM administrators WHERE status = 'ACTIVE'{campus}`), params)),
      faculty: num(await scalar(w(`SELECT COUNT(*) AS n FROM faculty WHERE status = 'ACTIVE'{campus}`), params)),
      teachingStaff: num(
        await scalar(
          w(
            `SELECT COUNT(*) AS n FROM faculty WHERE staff_type = 'TEACHING' AND status = 'ACTIVE'{campus}` +
              (selectedBoard(req) ? " AND (board = ? OR board = 'BOTH')" : '')
          ),
          selectedBoard(req) ? [...params, selectedBoard(req)] : params
        )
      ),
      financialStaff: num(
        await scalar(w(`SELECT COUNT(*) AS n FROM faculty WHERE staff_type = 'FINANCIAL' AND status = 'ACTIVE'{campus}`), params)
      ),
      students: num(await scalar(wb(`SELECT COUNT(*) AS n FROM students WHERE status = 'ACTIVE'{campus}{board}`), pb)),
      parents: num(await scalar(w(`SELECT COUNT(*) AS n FROM parents WHERE status = 'ACTIVE'{campus}`), params)),
      classes: num(await scalar(wb(`SELECT COUNT(*) AS n FROM classes WHERE status = 'ACTIVE'{campus}{board}`), pb)),
      courses: num(
        await scalar(
          `SELECT COUNT(*) AS n FROM courses co JOIN classes c ON c.id = co.class_id
            WHERE co.status = 'ACTIVE'${clause.replace('campus_id', 'co.campus_id')}${board.clause.replace('board', 'c.board')}`,
          pb
        )
      ),
      users: num(await scalar(w(`SELECT COUNT(*) AS n FROM users WHERE status = 'ACTIVE'{campus}`), params)),
      campuses: num(await scalar(`SELECT COUNT(*) AS n FROM campuses WHERE status = 'ACTIVE'`)),
    };

    const attendanceToday = await get(
      wb(`SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absent
           FROM attendance WHERE attendance_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus}
             ${board.clause ? 'AND student_id IN (SELECT id FROM students WHERE board = ?)' : ''}`),
      pb
    );

    const attendanceTrend = (await all(
      w(`SELECT attendance_date AS date, COUNT(*) AS total,
                SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
           FROM attendance WHERE substr(attendance_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC') + interval '-14 days', 'YYYY-MM-DD'){campus}
          GROUP BY attendance_date ORDER BY attendance_date`),
      params
    )).map((r) => ({ ...r, percentage: pct(r.present, r.total) }));

    const fees = await get(
      w(`SELECT COALESCE(SUM(total_amount - discount_amount), 0) AS billed,
                COALESCE(SUM(paid_amount), 0) AS collected,
                COALESCE(SUM(total_amount - discount_amount - paid_amount), 0) AS pending
           FROM student_fees WHERE 1 = 1{campus}`),
      params
    );
    const collectionMonth = num(
      await scalar(
        w(`SELECT COALESCE(SUM(amount), 0) AS n FROM fee_payments
            WHERE substr(payment_date, 1, 7) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM'){campus}`),
        params
      )
    );

    const examinations = {
      total: num(await scalar(w(`SELECT COUNT(*) AS n FROM examinations WHERE 1 = 1{campus}`), params)),
      upcoming: num(
        await scalar(w(`SELECT COUNT(*) AS n FROM examinations WHERE substr(start_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus}`), params)
      ),
      pendingApproval: num(await scalar(w(`SELECT COUNT(*) AS n FROM marks WHERE status = 'SUBMITTED'{campus}`), params)),
      resultsPublished: num(await scalar(w(`SELECT COUNT(*) AS n FROM results WHERE published = 1{campus}`), params)),
    };

    const transport = {
      vehicles: num(await scalar(w(`SELECT COUNT(*) AS n FROM vehicles WHERE 1 = 1{campus}`), params)),
      routes: num(await scalar(w(`SELECT COUNT(*) AS n FROM routes WHERE status = 'ACTIVE'{campus}`), params)),
      studentsAllocated: num(
        await scalar(w(`SELECT COUNT(*) AS n FROM transport_allocations WHERE status = 'ACTIVE'{campus}`), params)
      ),
      drivers: num(await scalar(w(`SELECT COUNT(*) AS n FROM drivers WHERE status = 'ACTIVE'{campus}`), params)),
    };

    // Head-count split across the school's two departments.
    const byDepartment = await all(
      `SELECT board,
              COUNT(*) AS students,
              (SELECT COUNT(*) FROM classes c WHERE c.board = s.board AND c.status = 'ACTIVE'
                 ${clause ? 'AND c.campus_id = ?' : ''}) AS classes
         FROM students s
        WHERE s.status = 'ACTIVE'${clause ? ' AND s.campus_id = ?' : ''}
        GROUP BY board ORDER BY board`,
      clause ? [req.user.campus_id, req.user.campus_id] : []
    );

    const recentActivity = await all(
      `SELECT id, user_name, role_code, action, module, description, created_at, status
         FROM activity_logs ORDER BY created_at DESC LIMIT 12`
    );

    const notifications = await all(
      `SELECT id, type, title, body, link, is_read, created_at FROM notifications
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
      [req.user.id]
    );

    const usersByRole = await all(
      w(`SELECT r.code AS role, r.name AS role_name, COUNT(u.id) AS count
           FROM roles r LEFT JOIN users u ON u.role_id = r.id AND u.status = 'ACTIVE'{campus}
          GROUP BY r.id ORDER BY r.level`),
      params
    );

    const enrollmentByClass = await all(
      `SELECT c.name AS class_name, c.board, COUNT(s.id) AS students
         FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'ACTIVE'
        WHERE c.status = 'ACTIVE'${clause.replace('campus_id', 'c.campus_id')}${board.clause.replace('board', 'c.board')}
        GROUP BY c.id ORDER BY c.board, c.numeric_level`,
      pb
    );

    return ok(res, {
      counts,
      attendance: { today: { ...attendanceToday, percentage: pct(attendanceToday?.present, attendanceToday?.total) }, trend: attendanceTrend },
      fees: { ...fees, collectionMonth, collectionRate: pct(fees?.collected, fees?.billed) },
      examinations,
      transport,
      usersByRole,
      selectedDepartment: selectedBoard(req),
      byDepartment,
      enrollmentByClass,
      recentActivity,
      notifications,
    });
  })
);

// =====================================================================
// ADMINISTRATOR — student & faculty operations
// =====================================================================
router.get(
  '/administrator',
  requireRole(ROLES.ADMINISTRATOR, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { clause, params } = campusFilter(req);
    const board = boardFilter(req);
    const w = (sql) => sql.replace(/\{campus\}/g, clause);
    const wb = (sql) => sql.replace(/\{campus\}/g, clause).replace(/\{board\}/g, board.clause);
    const pb = [...params, ...board.params];

    const students = {
      total: num(await scalar(wb(`SELECT COUNT(*) AS n FROM students WHERE 1 = 1{campus}{board}`), pb)),
      active: num(await scalar(wb(`SELECT COUNT(*) AS n FROM students WHERE status = 'ACTIVE'{campus}{board}`), pb)),
      newAdmissions: num(
        await scalar(
          wb(`SELECT COUNT(*) AS n FROM students
               WHERE substr(admission_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC') + interval '-30 days', 'YYYY-MM-DD'){campus}{board}`),
          pb
        )
      ),
      inactive: num(await scalar(wb(`SELECT COUNT(*) AS n FROM students WHERE status != 'ACTIVE'{campus}{board}`), pb)),
    };

    const faculty = {
      total: num(await scalar(w(`SELECT COUNT(*) AS n FROM faculty WHERE status = 'ACTIVE'{campus}`), params)),
      teaching: num(
        await scalar(w(`SELECT COUNT(*) AS n FROM faculty WHERE staff_type = 'TEACHING' AND status = 'ACTIVE'{campus}`), params)
      ),
      financial: num(
        await scalar(w(`SELECT COUNT(*) AS n FROM faculty WHERE staff_type = 'FINANCIAL' AND status = 'ACTIVE'{campus}`), params)
      ),
    };

    const studentAttendance = await get(
      w(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
           FROM attendance WHERE attendance_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus}`),
      params
    );
    const facultyAttendance = await get(
      w(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
           FROM faculty_attendance WHERE attendance_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus}`),
      params
    );

    const upcomingExams = await all(
      w(`SELECT id, name, exam_type, start_date, end_date, status FROM examinations
          WHERE substr(start_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus} ORDER BY start_date LIMIT 6`),
      params
    );

    const pendingRequests = {
      leave: num(await scalar(w(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'PENDING'{campus}`), params)),
      marksApproval: num(await scalar(w(`SELECT COUNT(*) AS n FROM marks WHERE status = 'SUBMITTED'{campus}`), params)),
      documents: num(await scalar(w(`SELECT COUNT(*) AS n FROM documents WHERE verified = 0{campus}`), params)),
    };
    pendingRequests.total = pendingRequests.leave + pendingRequests.marksApproval + pendingRequests.documents;

    const recentAnnouncements = await all(
      w(`SELECT id, title, content, priority, target_type, publish_date, is_published
           FROM announcements WHERE 1 = 1{campus} ORDER BY created_at DESC LIMIT 6`),
      params
    );

    const recentAdmissions = await all(
      `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.admission_date, s.photo,
              c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE 1 = 1${clause.replace('campus_id', 's.campus_id')} ORDER BY s.id DESC LIMIT 8`,
      params
    );

    const byDepartment = await all(
      `SELECT board, COUNT(*) AS students FROM students
        WHERE status = 'ACTIVE'${clause} GROUP BY board ORDER BY board`,
      params
    );

    const selectedDepartment = selectedBoard(req);

    const classStrength = await all(
      `SELECT c.name AS class_name, sec.name AS section_name, COUNT(s.id) AS students, sec.capacity
         FROM sections sec
         JOIN classes c ON c.id = sec.class_id
         LEFT JOIN students s ON s.section_id = sec.id AND s.status = 'ACTIVE'
        WHERE sec.status = 'ACTIVE'${clause.replace('campus_id', 'sec.campus_id')}
        GROUP BY sec.id, c.id ORDER BY c.numeric_level, sec.name`,
      params
    );

    const leaveQueue = await all(
      `SELECT lr.id, lr.requester_type, lr.from_date, lr.to_date, lr.reason, lr.leave_type, lr.created_at,
              s.first_name AS student_name, s.admission_number, fu.full_name AS faculty_name
         FROM leave_requests lr
         LEFT JOIN students s ON s.id = lr.student_id
         LEFT JOIN faculty f ON f.id = lr.faculty_id
         LEFT JOIN users fu ON fu.id = f.user_id
        WHERE lr.status = 'PENDING'${clause.replace('campus_id', 'lr.campus_id')} ORDER BY lr.created_at LIMIT 8`,
      params
    );

    return ok(res, {
      students,
      faculty,
      attendance: {
        student: { ...studentAttendance, percentage: pct(studentAttendance?.present, studentAttendance?.total) },
        faculty: { ...facultyAttendance, percentage: pct(facultyAttendance?.present, facultyAttendance?.total) },
      },
      byDepartment,
      selectedDepartment,
      upcomingExams,
      pendingRequests,
      recentAnnouncements,
      recentAdmissions,
      classStrength,
      leaveQueue,
    });
  })
);

// =====================================================================
// FINANCIAL STAFF
// =====================================================================
router.get(
  '/financial',
  requireRole(ROLES.FINANCIAL_STAFF, ROLES.ADMIN, ROLES.ADMINISTRATOR),
  asyncHandler(async (req, res) => {
    const { clause, params } = campusFilter(req);
    const w = (sql) => sql.replace(/\{campus\}/g, clause);

    const collection = {
      today: num(await scalar(w(`SELECT COALESCE(SUM(amount),0) AS n FROM fee_payments WHERE payment_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus}`), params)),
      month: num(
        await scalar(
          w(`SELECT COALESCE(SUM(amount),0) AS n FROM fee_payments
              WHERE substr(payment_date, 1, 7) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM'){campus}`),
          params
        )
      ),
      year: num(
        await scalar(
          w(`SELECT COALESCE(SUM(amount),0) AS n FROM fee_payments
              WHERE substr(payment_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY'){campus}`),
          params
        )
      ),
      transactionsToday: num(
        await scalar(w(`SELECT COUNT(*) AS n FROM fee_payments WHERE payment_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD'){campus}`), params)
      ),
    };

    const pending = await get(
      w(`SELECT COUNT(*) AS count, COALESCE(SUM(total_amount - discount_amount - paid_amount), 0) AS amount,
                COALESCE(SUM(CASE WHEN substr(due_date, 1, 10) < to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
                     THEN total_amount - discount_amount - paid_amount ELSE 0 END), 0) AS overdue
           FROM student_fees WHERE (total_amount - discount_amount - paid_amount) > 0.01{campus}`),
      params
    );

    const income = num(
      await scalar(w(`SELECT COALESCE(SUM(amount),0) AS n FROM income WHERE substr(income_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY'){campus}`), params)
    );
    const expenses = num(
      await scalar(
        w(`SELECT COALESCE(SUM(amount),0) AS n FROM expenses
            WHERE substr(expense_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY') AND status = 'APPROVED'{campus}`),
        params
      )
    );

    const payroll = await get(
      w(`SELECT COUNT(*) AS payslips, COALESCE(SUM(net_salary), 0) AS amount,
                SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid
           FROM payroll
          WHERE month = CAST(to_char((now() AT TIME ZONE 'UTC'), 'MM') AS INTEGER) AND year = CAST(to_char((now() AT TIME ZONE 'UTC'), 'YYYY') AS INTEGER){campus}`),
      params
    );

    const transportExpenses = {
      fuel: num(
        await scalar(
          w(`SELECT COALESCE(SUM(total_cost),0) AS n FROM fuel_records
              WHERE substr(fuel_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY'){campus}`),
          params
        )
      ),
      maintenance: num(
        await scalar(
          w(`SELECT COALESCE(SUM(cost),0) AS n FROM vehicle_maintenance
              WHERE substr(service_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY'){campus}`),
          params
        )
      ),
    };
    transportExpenses.total = transportExpenses.fuel + transportExpenses.maintenance;

    const recentTransactions = await all(
      `SELECT fp.id, fp.amount, fp.payment_date, fp.payment_mode, s.first_name, s.last_name,
              s.admission_number, c.name AS class_name, fr.receipt_number, fr.id AS receipt_id
         FROM fee_payments fp
         JOIN students s ON s.id = fp.student_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN fee_receipts fr ON fr.fee_payment_id = fp.id
        WHERE 1 = 1${clause.replace('campus_id', 'fp.campus_id')}
        ORDER BY fp.created_at DESC LIMIT 10`,
      params
    );

    const monthlyTrend = (await all(
      w(`SELECT substr(payment_date, 1, 7) AS month, SUM(amount) AS collected
           FROM fee_payments WHERE 1 = 1{campus} GROUP BY month ORDER BY month DESC LIMIT 12`),
      params
    )).reverse();

    const expenseByCategory = await all(
      w(`SELECT category, SUM(amount) AS amount FROM expenses
          WHERE substr(expense_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY') AND status = 'APPROVED'{campus}
          GROUP BY category ORDER BY amount DESC LIMIT 8`),
      params
    );

    return ok(res, {
      collection,
      pending,
      income,
      expenses,
      net: income - expenses,
      payroll,
      transportExpenses,
      recentTransactions,
      monthlyTrend,
      expenseByCategory,
    });
  })
);

// =====================================================================
// TEACHING STAFF — everything scoped to their own assignments
// =====================================================================
router.get(
  '/teaching',
  requireRole(ROLES.TEACHING_STAFF, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const facultyId = await facultyIdOf(req.user);
    if (!facultyId) throw forbidden('No faculty profile is linked to this account');

    const assignments = await all(
      `SELECT ca.id, ca.course_id, ca.section_id, co.name AS course_name, co.code AS course_code,
              sub.name AS subject_name, c.name AS class_name, c.board, sec.name AS section_name,
              (SELECT COUNT(*) FROM students s WHERE s.section_id = ca.section_id AND s.status = 'ACTIVE') AS student_count
         FROM course_assignments ca
         JOIN courses co ON co.id = ca.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         JOIN sections sec ON sec.id = ca.section_id
         JOIN classes c ON c.id = sec.class_id
        WHERE ca.faculty_id = ? AND ca.status = 'ACTIVE'
        ORDER BY c.numeric_level, sec.name`,
      [facultyId]
    );

    const weekday = new Date().getDay() === 0 ? 7 : new Date().getDay();
    const todayClasses = await all(
      `SELECT t.id, t.period, t.start_time, t.end_time, t.room, t.section_id, t.course_id,
              co.name AS course_name, sub.name AS subject_name, c.name AS class_name, sec.name AS section_name
         FROM timetables t
         LEFT JOIN courses co ON co.id = t.course_id
         LEFT JOIN subjects sub ON sub.id = co.subject_id
         LEFT JOIN classes c ON c.id = t.class_id
         LEFT JOIN sections sec ON sec.id = t.section_id
        WHERE t.faculty_id = ? AND t.day_of_week = ?
        ORDER BY t.period`,
      [facultyId, weekday]
    );

    const sectionIds = [...new Set(assignments.map((a) => a.section_id))];
    const studentCount = sectionIds.length
      ? num(
          await scalar(
            `SELECT COUNT(DISTINCT id) AS n FROM students
              WHERE status = 'ACTIVE' AND section_id IN (${sectionIds.map(() => '?').join(',')})`,
            sectionIds
          )
        )
      : 0;

    const attendanceToday = await get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
         FROM attendance WHERE attendance_date = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AND marked_by = ?`,
      [req.user.id]
    );

    const pendingMarks = await all(
      `SELECT es.id AS exam_subject_id, e.name AS exam_name, co.name AS course_name, sub.name AS subject_name,
              es.exam_date, es.max_marks,
              (SELECT COUNT(*) FROM marks m WHERE m.exam_subject_id = es.id AND m.status IN ('DRAFT','REJECTED')) AS drafts,
              (SELECT COUNT(*) FROM marks m WHERE m.exam_subject_id = es.id) AS entered
         FROM exam_subjects es
         JOIN examinations e ON e.id = es.examination_id
         JOIN courses co ON co.id = es.course_id
         JOIN subjects sub ON sub.id = co.subject_id
        WHERE es.course_id IN (SELECT course_id FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE')
          AND e.status IN ('SCHEDULED','ONGOING','COMPLETED')
        ORDER BY es.exam_date DESC LIMIT 10`,
      [facultyId]
    );

    const materials = {
      total: num(await scalar('SELECT COUNT(*) AS n FROM course_materials WHERE faculty_id = ?', [facultyId])),
      recent: await all(
        `SELECT cm.id, cm.title, cm.material_type, cm.created_at, co.name AS course_name
           FROM course_materials cm JOIN courses co ON co.id = cm.course_id
          WHERE cm.faculty_id = ? ORDER BY cm.created_at DESC LIMIT 5`,
        [facultyId]
      ),
    };

    const mentees = await all(
      `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.photo,
              c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE s.mentor_id = ? AND s.status = 'ACTIVE' ORDER BY s.first_name LIMIT 12`,
      [facultyId]
    );

    const timetable = await all(
      `SELECT t.day_of_week, t.period, t.start_time, t.end_time, t.room,
              co.name AS course_name, c.name AS class_name, sec.name AS section_name
         FROM timetables t
         LEFT JOIN courses co ON co.id = t.course_id
         LEFT JOIN classes c ON c.id = t.class_id
         LEFT JOIN sections sec ON sec.id = t.section_id
        WHERE t.faculty_id = ? ORDER BY t.day_of_week, t.period`,
      [facultyId]
    );

    const notifications = await all(
      `SELECT id, type, title, body, link, is_read, created_at FROM notifications
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
      [req.user.id]
    );

    return ok(res, {
      counts: {
        assignedCourses: new Set(assignments.map((a) => a.course_id)).size,
        assignments: assignments.length,
        students: studentCount,
        todayClasses: todayClasses.length,
        mentees: num(await scalar(`SELECT COUNT(*) AS n FROM students WHERE mentor_id = ? AND status = 'ACTIVE'`, [facultyId])),
        pendingMarks: pendingMarks.filter((p) => p.drafts > 0 || p.entered === 0).length,
        materials: materials.total,
      },
      assignments,
      todayClasses,
      attendanceToday: { ...attendanceToday, percentage: pct(attendanceToday?.present, attendanceToday?.total) },
      pendingMarks,
      materials: materials.recent,
      mentees,
      timetable,
      notifications,
    });
  })
);

// =====================================================================
// STUDENT
// =====================================================================
router.get(
  '/student',
  requireRole(ROLES.STUDENT, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const studentId = await studentIdOf(req.user);
    if (!studentId) throw forbidden('No student profile is linked to this account');
    return ok(res, await buildStudentDashboard(studentId, req.user.id));
  })
);

// =====================================================================
// PARENT — the same payload, for the selected child
// =====================================================================
router.get(
  '/parent',
  requireRole(ROLES.PARENT, ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const children = await childrenOf(req.user);
    if (!children.length) return ok(res, { children: [], selectedChild: null, dashboard: null });

    const requested = req.query.student_id ? Number(req.query.student_id) : children[0].id;
    if (!children.some((c) => c.id === requested)) {
      throw forbidden('That student is not linked to your account');
    }

    const dashboard = await buildStudentDashboard(requested, null);
    return ok(res, {
      children,
      selectedChild: children.find((c) => c.id === requested),
      dashboard,
      notifications: await all(
        `SELECT id, type, title, body, link, is_read, created_at FROM notifications
          WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
        [req.user.id]
      ),
    });
  })
);

/**
 * The shared student payload used by both the student and parent dashboards,
 * so a parent sees exactly what the student sees for the selected child.
 */
async function buildStudentDashboard(studentId, userId) {
  const student = await get(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name, ay.name AS academic_year_name,
            u.full_name AS mentor_name, f.faculty_code AS mentor_code,
            (s.first_name || ' ' || COALESCE(s.last_name,'')) AS full_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
       LEFT JOIN faculty f ON f.id = s.mentor_id
       LEFT JOIN users u ON u.id = f.user_id
      WHERE s.id = ?`,
    [studentId]
  );

  const attendance = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absent
       FROM attendance WHERE student_id = ?`,
    [studentId]
  );

  const monthlyAttendance = (await all(
    `SELECT substr(attendance_date, 1, 7) AS month, COUNT(*) AS total,
            SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
       FROM attendance WHERE student_id = ? GROUP BY month ORDER BY month DESC LIMIT 6`,
    [studentId]
  )).reverse();

  const courses = await all(
    `SELECT DISTINCT co.id, co.code, co.name, sub.name AS subject_name,
            u.full_name AS faculty_name, sec.name AS section_name
       FROM courses co
       JOIN subjects sub ON sub.id = co.subject_id
       LEFT JOIN course_assignments ca ON ca.course_id = co.id AND ca.section_id = ?
       LEFT JOIN faculty f ON f.id = ca.faculty_id
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN sections sec ON sec.id = ca.section_id
      WHERE co.class_id = ? AND co.status = 'ACTIVE'
      ORDER BY sub.name`,
    [student?.section_id, student?.class_id]
  );

  const materials = await all(
    `SELECT cm.id, cm.title, cm.material_type, cm.file_path, cm.external_url, cm.due_date, cm.created_at,
            co.name AS course_name, u.full_name AS faculty_name
       FROM course_materials cm
       JOIN courses co ON co.id = cm.course_id
       JOIN faculty f ON f.id = cm.faculty_id
       JOIN users u ON u.id = f.user_id
      WHERE co.class_id = ? AND cm.is_published = 1 AND (cm.section_id IS NULL OR cm.section_id = ?)
      ORDER BY cm.created_at DESC LIMIT 8`,
    [student?.class_id, student?.section_id]
  );

  const results = await all(
    `SELECT r.id, r.examination_id, r.obtained_marks, r.total_marks, r.percentage, r.grade,
            r.rank_in_class, r.result_status, e.name AS exam_name, e.exam_type
       FROM results r JOIN examinations e ON e.id = r.examination_id
      WHERE r.student_id = ? AND r.published = 1
      ORDER BY r.created_at DESC LIMIT 6`,
    [studentId]
  );

  const fees = await get(
    `SELECT COALESCE(SUM(total_amount - discount_amount), 0) AS total,
            COALESCE(SUM(paid_amount), 0) AS paid,
            COALESCE(SUM(total_amount - discount_amount - paid_amount), 0) AS pending
       FROM student_fees WHERE student_id = ?`,
    [studentId]
  );

  const nextDue = await get(
    `SELECT sf.due_date, (sf.total_amount - sf.discount_amount - sf.paid_amount) AS amount, fs.name AS fee_name
       FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
      WHERE sf.student_id = ? AND (sf.total_amount - sf.discount_amount - sf.paid_amount) > 0.01
      ORDER BY sf.due_date LIMIT 1`,
    [studentId]
  );

  const timetableToday = await all(
    `SELECT t.period, t.start_time, t.end_time, t.room, co.name AS course_name, u.full_name AS faculty_name
       FROM timetables t
       LEFT JOIN courses co ON co.id = t.course_id
       LEFT JOIN faculty f ON f.id = t.faculty_id
       LEFT JOIN users u ON u.id = f.user_id
      WHERE t.section_id = ? AND t.day_of_week = ?
      ORDER BY t.period`,
    [student?.section_id, new Date().getDay() === 0 ? 7 : new Date().getDay()]
  );

  const upcoming = await all(
    `SELECT 'EXAM' AS type, es.exam_date AS date, sub.name AS title, e.name AS subtitle, es.start_time
       FROM exam_subjects es
       JOIN examinations e ON e.id = es.examination_id
       JOIN courses co ON co.id = es.course_id
       JOIN subjects sub ON sub.id = co.subject_id
      WHERE co.class_id = ? AND substr(es.exam_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
      UNION ALL
     SELECT 'EVENT' AS type, ev.start_date AS date, ev.title, ev.event_type AS subtitle, ev.start_time
       FROM events ev
      WHERE ev.campus_id = ? AND ev.is_published = 1 AND substr(ev.start_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
      ORDER BY date LIMIT 8`,
    [student?.class_id, student?.campus_id]
  );

  const transport = await get(
    `SELECT ta.pickup_point, ta.drop_point, ta.pickup_time, ta.drop_time, ta.status,
            r.name AS route_name, r.route_code, v.vehicle_number, v.vehicle_type,
            d.name AS driver_name, d.phone AS driver_phone
       FROM transport_allocations ta
       JOIN routes r ON r.id = ta.route_id
       LEFT JOIN vehicles v ON v.id = COALESCE(ta.vehicle_id, r.vehicle_id)
       LEFT JOIN drivers d ON d.id = r.driver_id
      WHERE ta.student_id = ? AND ta.status = 'ACTIVE' LIMIT 1`,
    [studentId]
  );

  const mentoring = await all(
    `SELECT mr.id, mr.title, mr.record_type, mr.notes, mr.meeting_date, mr.created_at,
            u.full_name AS mentor_name
       FROM mentoring_records mr
       JOIN faculty f ON f.id = mr.mentor_id
       JOIN users u ON u.id = f.user_id
      WHERE mr.student_id = ? ORDER BY mr.created_at DESC LIMIT 5`,
    [studentId]
  );

  const notifications = userId
    ? await all(
        `SELECT id, type, title, body, link, is_read, created_at FROM notifications
          WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
        [userId]
      )
    : [];

  return {
    student,
    attendance: {
      ...attendance,
      percentage: pct(attendance?.present, attendance?.total),
      monthly: monthlyAttendance.map((m) => ({ ...m, percentage: pct(m.present, m.total) })),
    },
    courses,
    materials,
    results,
    fees: { ...fees, nextDue, paidPercentage: pct(fees?.paid, fees?.total) },
    timetableToday,
    upcoming,
    transport,
    mentoring,
    notifications,
  };
}

export default router;
