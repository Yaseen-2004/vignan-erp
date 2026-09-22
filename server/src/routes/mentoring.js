import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { createResourceRouter } from '../lib/crud.js';
import {
  isAdmin, isTeacher, isStudent, isParent, facultyIdOf, studentIdOf, childrenOf, assertStudentAccess, sameId,
} from '../lib/scope.js';
import { notify } from '../lib/notify.js';
import { oid } from '../db/mongo/connection.js';
import { Attendance, MentoringRecord, Result, Student } from '../db/mongo/models.js';
import { lift } from '../db/mongo/query.js';

/**
 * Mentoring records.
 *   Mentor  -> records for their own mentees
 *   Student -> their own records
 *   Parent  -> their children's records, when marked visible to parents
 */
/**
 * `NONE` is the filter for someone entitled to none of these records.
 *
 * It has to be a condition nothing can remove. A filter naming a field the
 * collection does not have is dropped by strictQuery, and a dropped filter
 * does not mean "none" — it means "all". This is what `1 = 0` said.
 */
const NONE = { $expr: { $eq: [1, 0] } };

async function mentoringScope(req) {
  if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return null;

  if (isTeacher(req.user)) {
    const facultyId = await facultyIdOf(req.user);
    return facultyId ? { mentor_id: oid(facultyId) } : NONE;
  }
  if (isStudent(req.user)) {
    const studentId = await studentIdOf(req.user);
    return studentId ? { student_id: oid(studentId) } : NONE;
  }
  if (isParent(req.user)) {
    const ids = (await childrenOf(req.user)).map((c) => oid(c.id)).filter(Boolean);
    if (!ids.length) return NONE;
    // A parent sees only what the mentor chose to share with them.
    return { student_id: { $in: ids }, visible_to_parent: 1 };
  }
  return NONE;
}

const router = createResourceRouter({
  table: 'mentoring_records',
  module: 'mentoring',
  entityType: 'Mentoring Record',
  populate: {
    student_id: {
      first_name: 'first_name', last_name: 'last_name',
      admission_number: 'admission_number', photo: 'photo',
    },
    'student_id.class_id': { name: 'class_name' },
    'student_id.section_id': { name: 'section_name' },
    mentor_id: { faculty_code: 'faculty_code' },
    // The mentor's name is on their user record, not their faculty record —
    // two hops, as the pair of joins was.
    'mentor_id.user_id': { full_name: 'mentor_name' },
  },
  // Searching a joined table is not a filter on this collection; the pupil's
  // name is matched by the scope below rather than here.
  searchable: ['title', 'notes'],
  filterable: ['student_id', 'mentor_id', 'record_type'],
  sortable: ['id', 'meeting_date', 'created_at'],
  defaultSort: 'created_at',
  scopeFilter: mentoringScope,
  beforeCreate: async (data, req) => {
    // A mentor may only write records for students assigned to them.
    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const student = await Student.findById(oid(data.student_id)).select('mentor_id').lean();
      if (!student) throw notFound('Student not found');
      if (!sameId(student.mentor_id, facultyId)) throw forbidden('This student is not one of your mentees');
      data.mentor_id = facultyId;
    }
    data.created_by = req.user.id;
    return data;
  },
  canAccess: async (req, row) => {
    if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return true;
    if (isTeacher(req.user)) return sameId(row.mentor_id, await facultyIdOf(req.user));
    if (isStudent(req.user)) return sameId(row.student_id, await studentIdOf(req.user));
    if (isParent(req.user)) return (await childrenOf(req.user)).some((c) => sameId(c.id, row.student_id)) && !!row.visible_to_parent;
    return false;
  },
  afterCreate: async (row) => {
    const student = await Student.findById(oid(row.student_id)).select('user_id').lean();
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
    const facultyId = isTeacher(req.user) ? await facultyIdOf(req.user) : (req.query.mentor_id || null);
    if (!facultyId) throw forbidden('No mentor context available');

    /*
     * The mentees, with the two summaries the tutor actually looks at.
     *
     * The counts were correlated subqueries and the summaries a query per
     * pupil. Asked in groups here: a tutor with thirty mentees would otherwise
     * be sixty round trips to render one page.
     */
    const pupils = await Student.find({ mentor_id: oid(facultyId), status: 'ACTIVE' })
      .select('admission_number roll_number first_name last_name photo phone class_id section_id')
      .populate('class_id', 'name')
      .populate('section_id', 'name')
      .sort({ first_name: 1 });

    const mentees = lift(pupils, {
      class_id: { name: 'class_name' },
      section_id: { name: 'section_name' },
    });
    const ids = mentees.map((m) => oid(m.id)).filter(Boolean);

    const [records, attendance, results] = await Promise.all([
      MentoringRecord.aggregate([
        { $match: { student_id: { $in: ids } } },
        { $group: { _id: '$student_id', n: { $sum: 1 }, last: { $max: '$meeting_date' } } },
      ]),
      Attendance.aggregate([
        { $match: { student_id: { $in: ids } } },
        {
          $group: {
            _id: '$student_id',
            total: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
          },
        },
      ]),
      // The most recent published result for each — sorted before grouping, so
      // `$first` is genuinely the latest rather than whichever came back first.
      Result.aggregate([
        { $match: { student_id: { $in: ids }, published: 1 } },
        { $sort: { created_at: -1 } },
        { $group: { _id: '$student_id', percentage: { $first: '$percentage' }, grade: { $first: '$grade' } } },
      ]),
    ]);

    const byId = (rows) => new Map(rows.map((r) => [String(r._id), r]));
    const recordsById = byId(records);
    const attendanceById = byId(attendance);
    const resultsById = byId(results);

    for (const mentee of mentees) {
      const r = recordsById.get(mentee.id);
      mentee.record_count = r?.n ?? 0;
      mentee.last_meeting = r?.last ?? null;

      const a = attendanceById.get(mentee.id);
      mentee.attendance_percentage = a?.total
        ? Number(((a.present / a.total) * 100).toFixed(1))
        : null;

      const res2 = resultsById.get(mentee.id);
      mentee.last_percentage = res2?.percentage ?? null;
      mentee.last_grade = res2?.grade ?? null;
    }

    return ok(res, mentees);
  })
);

export default router;
