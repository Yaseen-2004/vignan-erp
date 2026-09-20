import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import {
  isAdmin, isTeacher, isStudent, isParent, facultyIdOf, studentIdOf,
  accessibleStudentIds, assertStudentAccess, teacherOwnsCourse, childrenOf,
} from '../lib/scope.js';
import { notify } from '../lib/notify.js';

const router = Router();

// Student attendance is a binary record: a student is either present or absent.
const STATUSES = ['PRESENT', 'ABSENT'];

// ------------------------------------------------- student attendance list
router.get(
  '/students',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query, 50);
    const clauses = [];
    const params = [];

    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('a.campus_id = ?');
      params.push(req.user.campus_id);
    }
    const allowed = await accessibleStudentIds(req.user);
    if (allowed !== null) {
      if (!allowed.length) return paginated(res, [], 0, { page, limit });
      clauses.push(`a.student_id IN (${allowed.map(() => '?').join(',')})`);
      params.push(...allowed);
    }
    for (const field of ['student_id', 'course_id', 'section_id', 'status', 'academic_year_id']) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        clauses.push(`a.${field} = ?`);
        params.push(req.query[field]);
      }
    }
    if (req.query.date) {
      clauses.push('a.attendance_date = ?');
      params.push(req.query.date);
    }
    if (req.query.from) {
      clauses.push('substr(a.attendance_date, 1, 10) >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push('substr(a.attendance_date, 1, 10) <= ?');
      params.push(req.query.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM attendance a ${where}`, params));
    const rows = await all(
      `SELECT a.*, s.first_name, s.last_name, s.admission_number, s.roll_number,
              co.name AS course_name, sec.name AS section_name, c.name AS class_name,
              u.full_name AS marked_by_name
         FROM attendance a
         JOIN students s ON s.id = a.student_id
         LEFT JOIN courses co ON co.id = a.course_id
         LEFT JOIN sections sec ON sec.id = a.section_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN users u ON u.id = a.marked_by
         ${where}
        ORDER BY a.attendance_date DESC, s.roll_number
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginated(res, rows, total, { page, limit });
  })
);

/**
 * The register a teacher opens to mark a class: every active student in the
 * section with any attendance already recorded for that date/period.
 */
router.get(
  '/register',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const sectionId = Number(req.query.section_id);
    const courseId = req.query.course_id ? Number(req.query.course_id) : null;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = Number(req.query.period || 0);
    if (!sectionId) throw badRequest('section_id is required');

    // Assignment check — a teacher may only open their own register.
    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await get(
        `SELECT 1 AS ok FROM course_assignments
          WHERE faculty_id = ? AND section_id = ? AND status = 'ACTIVE'${courseId ? ' AND course_id = ?' : ''}`,
        courseId ? [facultyId ?? 0, sectionId, courseId] : [facultyId ?? 0, sectionId]
      );
      if (!assigned) throw forbidden('This class is not assigned to you');
    }

    const students = await all(
      `SELECT s.id, s.admission_number, s.roll_number, s.first_name, s.last_name, s.photo,
              a.id AS attendance_id, a.status, a.remarks
         FROM students s
         LEFT JOIN attendance a
           ON a.student_id = s.id AND a.attendance_date = ? AND a.period = ?
          AND ${courseId ? 'a.course_id = ?' : 'a.course_id IS NULL'}
        WHERE s.section_id = ? AND s.status = 'ACTIVE'
        ORDER BY (CASE WHEN s.roll_number ~ '^[0-9]+$' THEN s.roll_number::int ELSE NULL END), s.first_name`,
      courseId ? [date, period, courseId, sectionId] : [date, period, sectionId]
    );

    const section = await get(
      `SELECT sec.*, c.name AS class_name FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ?`,
      [sectionId]
    );
    return ok(res, { date, period, course_id: courseId, section, students, marked: students.some((s) => s.attendance_id) });
  })
);

/**
 * The most recent earlier period marked for this section today.
 *
 * Attendance rarely changes between consecutive hours, so a teacher can pull
 * the previous hour forward and only correct the students who moved. Nothing
 * is written here — the register is filled in the browser and still goes
 * through the normal marking endpoint, which re-checks the assignment.
 */
router.get(
  '/previous',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const sectionId = Number(req.query.section_id);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = Number(req.query.period || 0);
    if (!sectionId) throw badRequest('section_id is required');

    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await get(
        `SELECT 1 AS ok FROM course_assignments WHERE faculty_id = ? AND section_id = ? AND status = 'ACTIVE'`,
        [facultyId ?? 0, sectionId]
      );
      if (!assigned) throw forbidden('This class is not assigned to you');
    }

    // The nearest earlier period that actually has records.
    const source = await get(
      `SELECT a.period, a.course_id, COUNT(*) AS marked
         FROM attendance a
        WHERE a.section_id = ? AND a.attendance_date = ? AND a.period < ?
        GROUP BY a.period, a.course_id
        ORDER BY a.period DESC LIMIT 1`,
      [sectionId, date, period]
    );

    if (!source) {
      return ok(res, { found: false, period: null, records: [] });
    }

    const records = await all(
      `SELECT a.student_id, a.status, a.remarks
         FROM attendance a
        WHERE a.section_id = ? AND a.attendance_date = ? AND a.period = ?
          AND ${source.course_id ? 'a.course_id = ?' : 'a.course_id IS NULL'}`,
      source.course_id ? [sectionId, date, source.period, source.course_id] : [sectionId, date, source.period]
    );

    const course = source.course_id
      ? await get('SELECT name FROM courses WHERE id = ?', [source.course_id])
      : null;

    return ok(res, {
      found: true,
      period: source.period,
      course_name: course?.name ?? null,
      marked: records.length,
      records,
    });
  })
);

/** Bulk mark / update attendance for a class. */
router.post(
  '/mark',
  requirePermission('attendance.create'),
  validateBody(
    z.object({
      section_id: z.coerce.number().int().positive(),
      course_id: z.coerce.number().int().positive().optional().nullable(),
      academic_year_id: z.coerce.number().int().positive().optional().nullable(),
      attendance_date: z.string().min(8).max(20),
      period: z.coerce.number().int().min(0).max(12).default(0),
      records: z
        .array(
          z.object({
            student_id: z.coerce.number().int().positive(),
            status: z.enum(STATUSES),
            remarks: z.string().max(200).optional().nullable(),
          })
        )
        .min(1, 'No attendance records supplied'),
    })
  ),
  asyncHandler(async (req, res) => {
    const { section_id, course_id, attendance_date, period, records, academic_year_id } = req.body;

    if (new Date(attendance_date) > new Date(new Date().toISOString().slice(0, 10))) {
      throw badRequest('Attendance cannot be marked for a future date');
    }

    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await get(
        `SELECT 1 AS ok FROM course_assignments
          WHERE faculty_id = ? AND section_id = ? AND status = 'ACTIVE'${course_id ? ' AND course_id = ?' : ''}`,
        course_id ? [facultyId ?? 0, section_id, course_id] : [facultyId ?? 0, section_id]
      );
      if (!assigned) throw forbidden('You may only mark attendance for classes assigned to you');
    }

    const sectionStudents = new Set(
      (await all(`SELECT id FROM students WHERE section_id = ? AND status = 'ACTIVE'`, [section_id])).map((r) => r.id)
    );
    const campusId = req.user.campus_id;

    const summary = await transaction(async () => {
      let inserted = 0;
      let updated = 0;
      const absentees = [];

      for (const record of records) {
        if (!sectionStudents.has(record.student_id)) continue; // silently skip foreign students

        const existing = await get(
          `SELECT * FROM attendance WHERE student_id = ? AND attendance_date = ? AND period = ?
             AND ${course_id ? 'course_id = ?' : 'course_id IS NULL'}`,
          course_id
            ? [record.student_id, attendance_date, period, course_id]
            : [record.student_id, attendance_date, period]
        );

        if (existing) {
          await run(
            `UPDATE attendance SET status = ?, remarks = ?, marked_by = ?, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
            [record.status, record.remarks ?? null, req.user.id, existing.id]
          );
          updated += 1;
        } else {
          await insert('attendance', {
            campus_id: campusId,
            student_id: record.student_id,
            course_id: course_id ?? null,
            section_id,
            academic_year_id: academic_year_id ?? null,
            attendance_date,
            period,
            status: record.status,
            remarks: record.remarks ?? null,
            marked_by: req.user.id,
          });
          inserted += 1;
        }
        if (record.status === 'ABSENT') absentees.push(record.student_id);
      }
      return { inserted, updated, absentees };
    })();

    // Tell the parents of absent children.
    for (const studentId of summary.absentees) {
      const parentUsers = await all(
        `SELECT p.user_id FROM student_parents sp JOIN parents p ON p.id = sp.parent_id
          WHERE sp.student_id = ? AND p.user_id IS NOT NULL`,
        [studentId]
      );
      const student = await get('SELECT first_name, last_name FROM students WHERE id = ?', [studentId]);
      for (const parent of parentUsers) {
        await notify({
          userId: parent.user_id,
          campusId,
          type: 'ATTENDANCE',
          title: 'Absence recorded',
          body: `${student.first_name} ${student.last_name || ''} was marked absent on ${attendance_date}.`,
          link: '/parent/attendance',
          entityType: 'Student',
          entityId: studentId,
        });
      }
    }

    await logActivity({
      req,
      action: 'ATTENDANCE_UPDATE',
      module: 'attendance',
      entityType: 'Attendance',
      entityId: section_id,
      description: `Marked attendance for section #${section_id} on ${attendance_date} (period ${period}): ${summary.inserted} new, ${summary.updated} updated`,
      newValues: { section_id, course_id, attendance_date, period, count: records.length },
    });

    return created(res, summary);
  })
);

/** Per-student attendance summary: overall, monthly and per subject. */
router.get(
  '/summary/:studentId',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const studentId = Number(req.params.studentId);
    await assertStudentAccess(req.user, studentId);

    const overall = await get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'ABSENT'  THEN 1 ELSE 0 END) AS absent
         FROM attendance WHERE student_id = ?`,
      [studentId]
    );

    const monthly = await all(
      `SELECT substr(attendance_date, 1, 7) AS month,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
         FROM attendance WHERE student_id = ?
        GROUP BY month ORDER BY month DESC LIMIT 12`,
      [studentId]
    );

    const bySubject = await all(
      `SELECT co.id AS course_id, co.name AS course_name, sub.name AS subject_name,
              COUNT(*) AS total,
              SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present
         FROM attendance a
         JOIN courses co ON co.id = a.course_id
         JOIN subjects sub ON sub.id = co.subject_id
        WHERE a.student_id = ?
        GROUP BY co.id, sub.id ORDER BY sub.name`,
      [studentId]
    );

    const recent = await all(
      `SELECT a.attendance_date, a.status, a.period, a.remarks, co.name AS course_name
         FROM attendance a LEFT JOIN courses co ON co.id = a.course_id
        WHERE a.student_id = ? ORDER BY a.attendance_date DESC LIMIT 30`,
      [studentId]
    );

    const pct = (present, total) => (total ? Number(((present / total) * 100).toFixed(2)) : 0);
    return ok(res, {
      overall: { ...overall, percentage: pct(overall.present, overall.total) },
      monthly: monthly.map((m) => ({ ...m, percentage: pct(m.present, m.total) })),
      bySubject: bySubject.map((s) => ({ ...s, percentage: pct(s.present, s.total) })),
      recent,
    });
  })
);

/** Daily overview for administrators. */
router.get(
  '/overview',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? '' : ' AND a.campus_id = ?';
    const params = scope ? [date, campusId] : [date];

    const totals = await get(
      `SELECT COUNT(DISTINCT a.student_id) AS marked,
              SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN a.status = 'ABSENT'  THEN 1 ELSE 0 END) AS absent
         FROM attendance a WHERE a.attendance_date = ?${scope}`,
      params
    );

    const byClass = await all(
      `SELECT c.id, c.name AS class_name, sec.name AS section_name,
              COUNT(*) AS total,
              SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present
         FROM attendance a
         JOIN students s ON s.id = a.student_id
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE a.attendance_date = ?${scope}
        GROUP BY c.id, sec.id ORDER BY c.numeric_level, sec.name`,
      params
    );

    const trend = await all(
      `SELECT a.attendance_date AS date, COUNT(*) AS total,
              SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present
         FROM attendance a
        WHERE substr(a.attendance_date, 1, 10) >= date(?, '-14 days')${scope}
        GROUP BY a.attendance_date ORDER BY a.attendance_date`,
      params
    );

    return ok(res, {
      date,
      totals,
      byClass: byClass.map((r) => ({ ...r, percentage: r.total ? Number(((r.present / r.total) * 100).toFixed(1)) : 0 })),
      trend: trend.map((r) => ({ ...r, percentage: r.total ? Number(((r.present / r.total) * 100).toFixed(1)) : 0 })),
    });
  })
);

// ------------------------------------------------- faculty attendance
const facultyAttendanceRouter = createResourceRouter({
  table: 'faculty_attendance',
  module: 'faculty_attendance',
  entityType: 'Faculty Attendance',
  alias: 'fa',
  select: `fa.*, u.full_name AS faculty_name, f.faculty_code, f.staff_type, d.name AS department_name`,
  joins: `JOIN faculty f ON f.id = fa.faculty_id
          JOIN users u ON u.id = f.user_id
          LEFT JOIN departments d ON d.id = f.department_id`,
  searchable: ['u.full_name', 'f.faculty_code'],
  filterable: ['faculty_id', 'status', 'attendance_date'],
  sortable: ['id', 'attendance_date'],
  required: ['faculty_id', 'attendance_date', 'status'],
  defaultSort: 'attendance_date',
  beforeCreate: (data, req) => ({ ...data, marked_by: req.user.id }),
  // Faculty may only read their own attendance unless they can manage it.
  scopeClause: async (req) => {
    if (req.permissions.has('faculty_attendance.edit') || isAdmin(req.user)) return null;
    const facultyId = await facultyIdOf(req.user);
    return { clause: 'fa.faculty_id = ?', params: [facultyId ?? 0] };
  },
});

/** Bulk mark staff attendance for a day. */
facultyAttendanceRouter.post(
  '/bulk',
  requirePermission('faculty_attendance.create'),
  validateBody(
    z.object({
      attendance_date: z.string().min(8).max(20),
      records: z
        .array(
          z.object({
            faculty_id: z.coerce.number().int().positive(),
            status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY']),
            check_in: z.string().max(10).optional().nullable(),
            check_out: z.string().max(10).optional().nullable(),
            remarks: z.string().max(200).optional().nullable(),
          })
        )
        .min(1),
    })
  ),
  asyncHandler(async (req, res) => {
    const { attendance_date, records } = req.body;
    const campusId = req.user.campus_id;

    const summary = await transaction(async () => {
      let inserted = 0;
      let updated = 0;
      for (const record of records) {
        const faculty = await get('SELECT * FROM faculty WHERE id = ?', [record.faculty_id]);
        if (!faculty) continue;
        if (!isAdmin(req.user) && faculty.campus_id !== campusId) continue;

        const existing = await get('SELECT id FROM faculty_attendance WHERE faculty_id = ? AND attendance_date = ?', [
          record.faculty_id,
          attendance_date,
        ]);
        if (existing) {
          await update('faculty_attendance', existing.id, {
            status: record.status,
            check_in: record.check_in,
            check_out: record.check_out,
            remarks: record.remarks,
            marked_by: req.user.id,
          });
          updated += 1;
        } else {
          await insert('faculty_attendance', {
            campus_id: faculty.campus_id,
            faculty_id: record.faculty_id,
            attendance_date,
            status: record.status,
            check_in: record.check_in,
            check_out: record.check_out,
            remarks: record.remarks,
            marked_by: req.user.id,
          });
          inserted += 1;
        }
      }
      return { inserted, updated };
    })();

    await logActivity({
      req,
      action: 'ATTENDANCE_UPDATE',
      module: 'faculty_attendance',
      entityType: 'Faculty Attendance',
      description: `Marked staff attendance for ${attendance_date}: ${summary.inserted} new, ${summary.updated} updated`,
    });
    return created(res, summary);
  })
);
router.use('/faculty', facultyAttendanceRouter);

// ------------------------------------------------------- leave requests
const leaveRouter = createResourceRouter({
  table: 'leave_requests',
  module: 'leave',
  entityType: 'Leave Request',
  alias: 'lr',
  select: `lr.*,
           s.first_name AS student_first_name, s.last_name AS student_last_name, s.admission_number,
           fu.full_name AS faculty_name, f.faculty_code,
           ru.full_name AS reviewed_by_name, c.name AS class_name, sec.name AS section_name`,
  joins: `LEFT JOIN students s ON s.id = lr.student_id
          LEFT JOIN classes c ON c.id = s.class_id
          LEFT JOIN sections sec ON sec.id = s.section_id
          LEFT JOIN faculty f ON f.id = lr.faculty_id
          LEFT JOIN users fu ON fu.id = f.user_id
          LEFT JOIN users ru ON ru.id = lr.reviewed_by`,
  searchable: ['lr.reason', 's.first_name', 'fu.full_name'],
  filterable: ['status', 'requester_type', 'student_id', 'faculty_id', 'leave_type'],
  sortable: ['id', 'from_date', 'created_at'],
  required: ['requester_type', 'from_date', 'to_date', 'reason'],
  defaultSort: 'created_at',
  beforeCreate: async (data, req) => {
    data.raised_by = req.user.id;
    data.status = 'PENDING';

    // Students and parents may only raise leave for themselves / their child.
    if (isStudent(req.user)) {
      data.requester_type = 'STUDENT';
      data.student_id = await studentIdOf(req.user);
    } else if (isParent(req.user)) {
      data.requester_type = 'STUDENT';
      const children = (await childrenOf(req.user)).map((c) => c.id);
      if (!children.includes(Number(data.student_id))) throw forbidden('You may only raise leave for your own child');
    } else if (isTeacher(req.user) && data.requester_type === 'FACULTY') {
      data.faculty_id = await facultyIdOf(req.user);
    }
    return data;
  },
  // Requesters see their own; approvers see everything they may approve.
  scopeClause: async (req) => {
    if (req.permissions.has('leave.approve') || isAdmin(req.user)) return null;
    if (isStudent(req.user)) return { clause: 'lr.student_id = ?', params: [await studentIdOf(req.user) ?? 0] };
    if (isParent(req.user)) {
      const ids = (await childrenOf(req.user)).map((c) => c.id);
      if (!ids.length) return { clause: '1 = 0', params: [] };
      return { clause: `lr.student_id IN (${ids.map(() => '?').join(',')})`, params: ids };
    }
    const facultyId = await facultyIdOf(req.user);
    return { clause: 'lr.faculty_id = ?', params: [facultyId ?? 0] };
  },
});

/** Approve or reject — the approver must hold leave.approve. */
leaveRouter.post(
  '/:id/review',
  requirePermission('leave.approve'),
  validateBody(
    z.object({
      status: z.enum(['APPROVED', 'REJECTED']),
      review_remarks: z.string().max(400).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const leave = await get('SELECT * FROM leave_requests WHERE id = ?', [id]);
    if (!leave) throw notFound('Leave request not found');
    if (!isAdmin(req.user) && leave.campus_id !== req.user.campus_id) throw forbidden('Different campus');
    if (leave.status !== 'PENDING') throw badRequest(`This request has already been ${leave.status.toLowerCase()}`);

    await update('leave_requests', id, {
      status: req.body.status,
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
      review_remarks: req.body.review_remarks,
    });

    // Approved student leave is reflected in the attendance register.
    if (req.body.status === 'APPROVED' && leave.requester_type === 'STUDENT' && leave.student_id) {
      const student = await get('SELECT * FROM students WHERE id = ?', [leave.student_id]);
      let cursor = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const existing = await get(
          `SELECT id FROM attendance WHERE student_id = ? AND attendance_date = ? AND period = 0 AND course_id IS NULL`,
          [leave.student_id, day]
        );
        if (existing) await update('attendance', existing.id, { status: 'ABSENT', remarks: 'Approved leave', marked_by: req.user.id });
        else
          await insert('attendance', {
            campus_id: leave.campus_id,
            student_id: leave.student_id,
            section_id: student?.section_id ?? null,
            attendance_date: day,
            period: 0,
            status: 'ABSENT',
            remarks: 'Approved leave',
            marked_by: req.user.id,
          });
        cursor = new Date(cursor.getTime() + 86400000);
      }
    }

    if (leave.raised_by) {
      await notify({
        userId: leave.raised_by,
        campusId: leave.campus_id,
        type: 'LEAVE_' + req.body.status,
        title: `Leave ${req.body.status.toLowerCase()}`,
        body: `Your leave request for ${leave.from_date} to ${leave.to_date} was ${req.body.status.toLowerCase()}.`,
        link: '/leave',
        entityType: 'LeaveRequest',
        entityId: id,
      });
    }

    await logActivity({
      req,
      action: req.body.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      module: 'leave',
      entityType: 'Leave Request',
      entityId: id,
      description: `${req.body.status} leave request #${id}`,
      oldValues: { status: leave.status },
      newValues: { status: req.body.status, remarks: req.body.review_remarks },
    });

    return ok(res, await get('SELECT * FROM leave_requests WHERE id = ?', [id]));
  })
);
router.use('/leave', leaveRouter);

export default router;
