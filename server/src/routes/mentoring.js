import { Router } from 'express';
import { all, get } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { createResourceRouter } from '../lib/crud.js';
import {
  isAdmin, isTeacher, isStudent, isParent, facultyIdOf, studentIdOf, childrenOf, assertStudentAccess,
} from '../lib/scope.js';
import { notify } from '../lib/notify.js';

/**
 * Mentoring records.
 *   Mentor  -> records for their own mentees
 *   Student -> their own records
 *   Parent  -> their children's records, when marked visible to parents
 */
async function mentoringScope(req) {
  if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return null;

  if (isTeacher(req.user)) {
    const facultyId = await facultyIdOf(req.user);
    return { clause: 'mr.mentor_id = ?', params: [facultyId ?? 0] };
  }
  if (isStudent(req.user)) {
    return { clause: 'mr.student_id = ?', params: [await studentIdOf(req.user) ?? 0] };
  }
  if (isParent(req.user)) {
    const ids = (await childrenOf(req.user)).map((c) => c.id);
    if (!ids.length) return { clause: '1 = 0', params: [] };
    return {
      clause: `mr.student_id IN (${ids.map(() => '?').join(',')}) AND mr.visible_to_parent = 1`,
      params: ids,
    };
  }
  return { clause: '1 = 0', params: [] };
}

const router = createResourceRouter({
  table: 'mentoring_records',
  module: 'mentoring',
  entityType: 'Mentoring Record',
  alias: 'mr',
  select: `mr.*, s.first_name, s.last_name, s.admission_number, s.photo,
           u.full_name AS mentor_name, f.faculty_code, c.name AS class_name, sec.name AS section_name`,
  joins: `JOIN students s ON s.id = mr.student_id
          JOIN faculty f ON f.id = mr.mentor_id
          JOIN users u ON u.id = f.user_id
          LEFT JOIN classes c ON c.id = s.class_id
          LEFT JOIN sections sec ON sec.id = s.section_id`,
  searchable: ['mr.title', 'mr.notes', 's.first_name'],
  filterable: ['student_id', 'mentor_id', 'record_type'],
  sortable: ['id', 'meeting_date', 'created_at'],
  defaultSort: 'created_at',
  scopeClause: mentoringScope,
  beforeCreate: async (data, req) => {
    // A mentor may only write records for students assigned to them.
    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const student = await get('SELECT mentor_id FROM students WHERE id = ?', [data.student_id]);
      if (!student) throw notFound('Student not found');
      if (student.mentor_id !== facultyId) throw forbidden('This student is not one of your mentees');
      data.mentor_id = facultyId;
    }
    data.created_by = req.user.id;
    return data;
  },
  canAccess: async (req, row) => {
    if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return true;
    if (isTeacher(req.user)) return row.mentor_id === await facultyIdOf(req.user);
    if (isStudent(req.user)) return row.student_id === await studentIdOf(req.user);
    if (isParent(req.user)) return (await childrenOf(req.user)).some((c) => c.id === row.student_id) && !!row.visible_to_parent;
    return false;
  },
  afterCreate: async (row) => {
    const student = await get('SELECT user_id FROM students WHERE id = ?', [row.student_id]);
    if (student?.user_id) {
      await notify({
        userId: student.user_id,
        campusId: row.campus_id,
        type: 'MENTORING',
        title: 'New mentoring record',
        body: row.title,
        link: '/parent/mentoring',
        entityType: 'MentoringRecord',
        entityId: row.id,
      });
    }
  },
});

/** A mentor's mentee list with a snapshot of each student's standing. */
router.get(
  '/mentees/list',
  requirePermission('mentoring.view'),
  asyncHandler(async (req, res) => {
    const facultyId = isTeacher(req.user) ? await facultyIdOf(req.user) : Number(req.query.mentor_id) || null;
    if (!facultyId) throw forbidden('No mentor context available');

    const mentees = await all(
      `SELECT s.id, s.admission_number, s.roll_number, s.first_name, s.last_name, s.photo, s.phone,
              c.name AS class_name, sec.name AS section_name,
              (SELECT COUNT(*) FROM mentoring_records mr WHERE mr.student_id = s.id) AS record_count,
              (SELECT MAX(meeting_date) FROM mentoring_records mr WHERE mr.student_id = s.id) AS last_meeting
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE s.mentor_id = ? AND s.status = 'ACTIVE'
        ORDER BY s.first_name`,
      [facultyId]
    );

    for (const mentee of mentees) {
      const attendance = await get(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
           FROM attendance WHERE student_id = ?`,
        [mentee.id]
      );
      mentee.attendance_percentage = attendance?.total
        ? Number(((attendance.present / attendance.total) * 100).toFixed(1))
        : null;
      const result = await get(
        `SELECT percentage, grade FROM results WHERE student_id = ? AND published = 1
          ORDER BY created_at DESC LIMIT 1`,
        [mentee.id]
      );
      mentee.last_percentage = result?.percentage ?? null;
      mentee.last_grade = result?.grade ?? null;
    }

    return ok(res, mentees);
  })
);

export default router;
