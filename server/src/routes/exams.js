import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { optionalNumber, validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import {
  isAdmin, isTeacher, teacherOwnsCourse, facultyIdOf, assertStudentAccess,
  accessibleStudentIds, isStudent, isParent,
} from '../lib/scope.js';
import { notify, notifyMany } from '../lib/notify.js';

const router = Router();

/**
 * The aggregate percentage a student must reach to pass an examination.
 * Configurable per campus in System Settings; 35% unless changed.
 */
async function passingPercentage(campusId) {
  const row = await get(
    `SELECT value FROM system_settings
      WHERE key = 'passing_percentage' AND (campus_id = ? OR campus_id IS NULL)
      ORDER BY campus_id IS NULL LIMIT 1`,
    [campusId]
  );
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : 35;
}

/** Map a percentage to the configured grade band. */
async function gradeFor(campusId, percentage) {
  const row = await get(
    `SELECT code, grade_point, remarks FROM grades
      WHERE campus_id = ? AND ? >= min_percent AND ? <= max_percent
      ORDER BY min_percent DESC LIMIT 1`,
    [campusId, percentage, percentage]
  );
  return row?.code ?? null;
}

// ------------------------------------------------------------ examinations
const examRouter = createResourceRouter({
  table: 'examinations',
  module: 'examinations',
  entityType: 'Examination',
  alias: 'e',
  select: `e.*, ay.name AS academic_year_name, u.full_name AS created_by_name,
           (SELECT COUNT(*) FROM exam_subjects es WHERE es.examination_id = e.id) AS subject_count,
           (SELECT COUNT(*) FROM marks m WHERE m.examination_id = e.id) AS marks_count,
           (SELECT COUNT(*) FROM marks m WHERE m.examination_id = e.id AND m.status = 'SUBMITTED') AS pending_approval,
           (SELECT COUNT(*) FROM results r WHERE r.examination_id = e.id AND r.published = 1) AS published_results`,
  joins: `JOIN academic_years ay ON ay.id = e.academic_year_id
          LEFT JOIN users u ON u.id = e.created_by`,
  searchable: ['e.name', 'e.description'],
  filterable: ['academic_year_id', 'exam_type', 'status'],
  sortable: ['id', 'name', 'start_date'],
  required: ['name', 'academic_year_id'],
  defaultSort: 'start_date',
  afterCreate: async (row, req) => {
    // Announce a scheduled exam to students and parents of the campus.
    if (row.status === 'SCHEDULED') {
      const users = (await all(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.campus_id = ? AND r.code IN ('STUDENT','PARENT','TEACHING_STAFF') AND u.status = 'ACTIVE'`,
        [row.campus_id]
      )).map((u) => u.id);
      await notifyMany(users, {
        campusId: row.campus_id,
        type: 'EXAM_SCHEDULED',
        title: `Examination scheduled: ${row.name}`,
        body: row.start_date ? `Begins on ${row.start_date}.` : 'The schedule has been published.',
        link: '/calendar',
        entityType: 'Examination',
        entityId: row.id,
      });
    }
  },
});

/** Exam schedule: one row per subject with date, time and room. */
examRouter.get(
  '/:id/schedule',
  requirePermission('examinations.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exam = await get('SELECT * FROM examinations WHERE id = ?', [id]);
    if (!exam) throw notFound('Examination not found');

    const subjects = await all(
      `SELECT es.*, co.name AS course_name, co.code AS course_code, sub.name AS subject_name,
              c.name AS class_name, u.full_name AS invigilator_name
         FROM exam_subjects es
         JOIN courses co ON co.id = es.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         LEFT JOIN classes c ON c.id = COALESCE(es.class_id, co.class_id)
         LEFT JOIN faculty f ON f.id = es.invigilator_id
         LEFT JOIN users u ON u.id = f.user_id
        WHERE es.examination_id = ?
        ORDER BY es.exam_date, es.start_time`,
      [id]
    );
    return ok(res, { examination: exam, subjects });
  })
);

/**
 * Publish every approved result for an examination.
 * Only holders of results.publish (Admin / Administrator) may do this.
 */
examRouter.post(
  '/:id/publish-results',
  requirePermission('results.publish'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exam = await get('SELECT * FROM examinations WHERE id = ?', [id]);
    if (!exam) throw notFound('Examination not found');
    if (!isAdmin(req.user) && exam.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const pending = Number(await scalar(`SELECT COUNT(*) AS n FROM marks WHERE examination_id = ? AND status != 'APPROVED'`, [id]));
    if (pending) throw badRequest(`${pending} mark entries are still awaiting approval`);

    const count = (await run(
      `UPDATE results SET published = 1, published_by = ?, published_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        WHERE examination_id = ? AND published = 0`,
      [req.user.id, id]
    )).changes;
    await update('examinations', id, { status: 'RESULTS_PUBLISHED' });

    // Notify each student and their parents.
    const results = await all('SELECT student_id FROM results WHERE examination_id = ? AND published = 1', [id]);
    for (const result of results) {
      const student = await get('SELECT user_id, first_name FROM students WHERE id = ?', [result.student_id]);
      if (student?.user_id) {
        await notify({
          userId: student.user_id,
          campusId: exam.campus_id,
          type: 'RESULT_PUBLISHED',
          title: `Result published: ${exam.name}`,
          body: 'Your result is now available.',
          link: '/parent/results',
          entityType: 'Examination',
          entityId: id,
        });
      }
      const parents = await all(
        `SELECT p.user_id FROM student_parents sp JOIN parents p ON p.id = sp.parent_id
          WHERE sp.student_id = ? AND p.user_id IS NOT NULL`,
        [result.student_id]
      );
      for (const parent of parents) {
        await notify({
          userId: parent.user_id,
          campusId: exam.campus_id,
          type: 'RESULT_PUBLISHED',
          title: `Result published: ${exam.name}`,
          body: `${student?.first_name ?? 'Your child'}'s result is now available.`,
          link: '/parent/results',
          entityType: 'Examination',
          entityId: id,
        });
      }
    }

    await logActivity({
      req,
      action: 'PUBLISH',
      module: 'results',
      entityType: 'Examination',
      entityId: id,
      description: `Published ${count} result(s) for ${exam.name}`,
      newValues: { published: count },
    });
    return ok(res, { published: count });
  })
);

/**
 * Compute results for an examination from approved marks.
 * Totals, percentage, grade, class rank and attendance are all derived here.
 */
examRouter.post(
  '/:id/generate-results',
  requirePermission('results.create', 'results.edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exam = await get('SELECT * FROM examinations WHERE id = ?', [id]);
    if (!exam) throw notFound('Examination not found');
    if (!isAdmin(req.user) && exam.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const rows = await all(
      `SELECT m.student_id,
              SUM(COALESCE(m.marks_obtained, 0)) AS obtained,
              SUM(m.max_marks) AS total,
              SUM(CASE WHEN m.marks_obtained < es.pass_marks OR m.is_absent = 1 THEN 1 ELSE 0 END) AS failed_subjects
         FROM marks m
         JOIN exam_subjects es ON es.id = m.exam_subject_id
        WHERE m.examination_id = ? AND m.status = 'APPROVED'
        GROUP BY m.student_id`,
      [id]
    );
    if (!rows.length) throw badRequest('No approved marks are available for this examination');

    const passMark = await passingPercentage(exam.campus_id);

    const generated = await transaction(async () => {
      const processed = [];
      for (const row of rows) {
        const student = await get('SELECT * FROM students WHERE id = ?', [row.student_id]);
        if (!student) continue;

        const percentage = row.total ? Number(((row.obtained / row.total) * 100).toFixed(2)) : 0;
        const attendance = await get(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
             FROM attendance WHERE student_id = ?`,
          [row.student_id]
        );
        const attendancePercent = attendance?.total
          ? Number(((attendance.present / attendance.total) * 100).toFixed(2))
          : null;

        const payload = {
          campus_id: exam.campus_id,
          examination_id: id,
          student_id: row.student_id,
          class_id: student.class_id,
          section_id: student.section_id,
          total_marks: row.total,
          obtained_marks: row.obtained,
          percentage,
          grade: await gradeFor(exam.campus_id, percentage),
          attendance_percent: attendancePercent,
          // A student passes on the aggregate: 35% or above clears the exam.
          result_status: percentage >= passMark ? 'PASS' : 'FAIL',
        };

        const existing = await get('SELECT id, published FROM results WHERE examination_id = ? AND student_id = ?', [
          id,
          row.student_id,
        ]);
        if (existing) {
          // Never silently rewrite an already published result.
          if (!existing.published) await update('results', existing.id, payload);
        } else {
          await insert('results', payload);
        }
        processed.push(row.student_id);
      }

      // Class ranks, computed per class within the examination.
      const classes = await all(`SELECT DISTINCT class_id FROM results WHERE examination_id = ? AND class_id IS NOT NULL`, [id]);
      for (const { class_id } of classes) {
        const ranked = await all(
          `SELECT id FROM results WHERE examination_id = ? AND class_id = ? ORDER BY obtained_marks DESC, percentage DESC`,
          [id, class_id]
        );
        for (const [index, result] of ranked.entries()) {
          await run('UPDATE results SET rank_in_class = ? WHERE id = ?', [index + 1, result.id]);
        }
      }
      return processed;
    })();

    await update('examinations', id, { status: 'COMPLETED' });
    await logActivity({
      req,
      action: 'CREATE',
      module: 'results',
      entityType: 'Examination',
      entityId: id,
      description: `Generated results for ${generated.length} student(s) — ${exam.name}`,
    });
    return created(res, { generated: generated.length });
  })
);
router.use('/examinations', examRouter);

// ---------------------------------------------------------- exam subjects
router.use(
  '/exam-subjects',
  createResourceRouter({
    table: 'exam_subjects',
    module: 'examinations',
    entityType: 'Exam Subject',
    alias: 'es',
    select: `es.*, co.name AS course_name, co.code AS course_code, sub.name AS subject_name,
             c.name AS class_name, e.name AS exam_name, u.full_name AS invigilator_name`,
    joins: `JOIN examinations e ON e.id = es.examination_id
            JOIN courses co ON co.id = es.course_id
            JOIN subjects sub ON sub.id = co.subject_id
            LEFT JOIN classes c ON c.id = COALESCE(es.class_id, co.class_id)
            LEFT JOIN faculty f ON f.id = es.invigilator_id
            LEFT JOIN users u ON u.id = f.user_id`,
    searchable: ['co.name', 'sub.name'],
    filterable: ['examination_id', 'course_id', 'class_id'],
    sortable: ['id', 'exam_date'],
    required: ['examination_id', 'course_id'],
    defaultSort: 'exam_date',
  })
);

// ------------------------------------------------------------------ marks
/**
 * The class-and-section sheets a user may enter marks for in one examination.
 *
 * A teacher gets exactly the courses assigned to them, split per section, with
 * how far each sheet has progressed. Admin and Administrator get every sheet.
 * This is what the marks screen lists — previously it offered every subject in
 * the school, so a teacher picking any of them was refused.
 */
router.get(
  '/marks/assignments',
  requirePermission('marks.view'),
  asyncHandler(async (req, res) => {
    const examinationId = Number(req.query.examination_id);
    if (!examinationId) throw badRequest('examination_id is required');

    const exam = await get('SELECT * FROM examinations WHERE id = ?', [examinationId]);
    if (!exam) throw notFound('Examination not found');

    const teacherScoped = isTeacher(req.user);
    const facultyId = teacherScoped ? await facultyIdOf(req.user) : null;

    // One row per exam subject and section the caller is responsible for.
    const rows = await all(
      `SELECT es.id AS exam_subject_id, es.max_marks, es.pass_marks, es.exam_date, es.start_time, es.room,
              co.id AS course_id, co.name AS course_name, sub.name AS subject_name,
              c.id AS class_id, c.name AS class_name, c.numeric_level, c.board,
              sec.id AS section_id, sec.name AS section_name,
              u.full_name AS teacher_name
         FROM exam_subjects es
         JOIN courses co ON co.id = es.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         JOIN classes c ON c.id = co.class_id
         JOIN course_assignments ca ON ca.course_id = co.id AND ca.status = 'ACTIVE'
         JOIN sections sec ON sec.id = ca.section_id
         JOIN faculty f ON f.id = ca.faculty_id
         JOIN users u ON u.id = f.user_id
        WHERE es.examination_id = ?${teacherScoped ? ' AND ca.faculty_id = ?' : ''}
          ${isAdmin(req.user) ? '' : 'AND es.campus_id = ?'}
        ORDER BY c.board, c.numeric_level, sec.name, sub.name`,
      [
        examinationId,
        ...(teacherScoped ? [facultyId ?? 0] : []),
        ...(isAdmin(req.user) ? [] : [req.user.campus_id]),
      ]
    );

    // Progress per sheet: how many of that section's students are done.
    for (const row of rows) {
      const roster = Number(
        await scalar(`SELECT COUNT(*) AS n FROM students WHERE section_id = ? AND status = 'ACTIVE'`, [row.section_id]) || 0
      );
      const progress = await get(
        `SELECT COUNT(*) AS entered,
                SUM(CASE WHEN m.status = 'SUBMITTED' THEN 1 ELSE 0 END) AS submitted,
                SUM(CASE WHEN m.status = 'APPROVED'  THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN m.status = 'REJECTED'  THEN 1 ELSE 0 END) AS rejected
           FROM marks m
           JOIN students s ON s.id = m.student_id
          WHERE m.exam_subject_id = ? AND s.section_id = ?`,
        [row.exam_subject_id, row.section_id]
      );
      row.students = roster;
      row.entered = Number(progress?.entered || 0);
      row.state = progress?.approved > 0
        ? 'APPROVED'
        : progress?.rejected > 0
          ? 'REJECTED'
          : progress?.submitted > 0
            ? 'SUBMITTED'
            : row.entered > 0
              ? 'DRAFT'
              : 'PENDING';
    }

    // Grouped the way the screen presents it: class, then its sections.
    const classes = [];
    for (const row of rows) {
      let group = classes.find((g) => g.class_id === row.class_id);
      if (!group) {
        group = {
          class_id: row.class_id,
          class_name: row.class_name,
          board: row.board,
          numeric_level: row.numeric_level,
          sections: [],
        };
        classes.push(group);
      }
      let section = group.sections.find((x) => x.section_id === row.section_id);
      if (!section) {
        section = { section_id: row.section_id, section_name: row.section_name, students: row.students, sheets: [] };
        group.sections.push(section);
      }
      section.sheets.push(row);
    }

    return ok(res, { examination: exam, classes, total: rows.length });
  })
);

/**
 * Mark-entry sheet for one exam subject: the roster plus any existing marks.
 * A teacher may only open a sheet for a course assigned to them.
 */
router.get(
  '/marks/sheet',
  requirePermission('marks.view'),
  asyncHandler(async (req, res) => {
    const examSubjectId = Number(req.query.exam_subject_id);
    if (!examSubjectId) throw badRequest('exam_subject_id is required');

    const examSubject = await get(
      `SELECT es.*, co.name AS course_name, co.class_id AS course_class_id, sub.name AS subject_name,
              e.name AS exam_name, e.status AS exam_status
         FROM exam_subjects es
         JOIN courses co ON co.id = es.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         JOIN examinations e ON e.id = es.examination_id
        WHERE es.id = ?`,
      [examSubjectId]
    );
    if (!examSubject) throw notFound('Exam subject not found');

    const params = [examSubjectId, examSubject.course_class_id];
    let sectionFilter = '';
    const requestedSection = req.query.section_id ? Number(req.query.section_id) : null;

    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const sections = (await all(
        `SELECT section_id FROM course_assignments WHERE course_id = ? AND faculty_id = ? AND status = 'ACTIVE'`,
        [examSubject.course_id, facultyId ?? 0]
      )).map((r) => r.section_id);
      if (!sections.length) throw forbidden('This course is not assigned to you');

      // One section at a time when asked for — but only one of their own.
      if (requestedSection) {
        if (!sections.includes(requestedSection)) throw forbidden('That section is not assigned to you');
        sectionFilter = ' AND s.section_id = ?';
        params.push(requestedSection);
      } else {
        sectionFilter = ` AND s.section_id IN (${sections.map(() => '?').join(',')})`;
        params.push(...sections);
      }
    } else if (requestedSection) {
      sectionFilter = ' AND s.section_id = ?';
      params.push(requestedSection);
    }

    const students = await all(
      `SELECT s.id AS student_id, s.admission_number, s.roll_number, s.first_name, s.last_name,
              sec.name AS section_name,
              m.id AS mark_id, m.marks_obtained, m.grade, m.is_absent, m.remarks, m.status
         FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN marks m ON m.student_id = s.id AND m.exam_subject_id = ?
        WHERE s.class_id = ? AND s.status = 'ACTIVE'${sectionFilter}
        ORDER BY (CASE WHEN s.roll_number ~ '^[0-9]+$' THEN s.roll_number::int ELSE NULL END), s.first_name`,
      params
    );

    const section = requestedSection
      ? await get(
          `SELECT sec.id, sec.name, c.name AS class_name, c.board
             FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = ?`,
          [requestedSection]
        )
      : null;

    return ok(res, {
      examSubject,
      section,
      students,
      locked: students.some((s) => s.status === 'APPROVED'),
    });
  })
);

/** Teacher saves (DRAFT) or submits (SUBMITTED) marks for their course. */
router.post(
  '/marks/entry',
  requirePermission('marks.create', 'marks.edit'),
  validateBody(
    z.object({
      exam_subject_id: z.coerce.number().int().positive(),
      submit: z.boolean().default(false),
      records: z
        .array(
          z.object({
            student_id: z.coerce.number().int().positive(),
            marks_obtained: optionalNumber(0),
            is_absent: z.coerce.boolean().default(false),
            remarks: z.string().max(200).optional().nullable(),
          })
        )
        .min(1, 'No marks supplied'),
    })
  ),
  asyncHandler(async (req, res) => {
    const { exam_subject_id, records, submit } = req.body;
    const examSubject = await get(
      `SELECT es.*, e.campus_id AS exam_campus_id, e.status AS exam_status FROM exam_subjects es
         JOIN examinations e ON e.id = es.examination_id WHERE es.id = ?`,
      [exam_subject_id]
    );
    if (!examSubject) throw notFound('Exam subject not found');

    // Assignment check — Teacher A can never write Teacher B's marks.
    if (isTeacher(req.user) && !await teacherOwnsCourse(req.user, examSubject.course_id)) {
      throw forbidden('You may only enter marks for courses assigned to you');
    }

    const summary = await transaction(async () => {
      let saved = 0;
      for (const record of records) {
        if (!record.is_absent && record.marks_obtained != null) {
          if (record.marks_obtained > examSubject.max_marks) {
            throw badRequest(`Marks cannot exceed the maximum of ${examSubject.max_marks}`);
          }
        }
        const percentage = record.is_absent
          ? 0
          : ((record.marks_obtained ?? 0) / examSubject.max_marks) * 100;

        const existing = await get('SELECT * FROM marks WHERE exam_subject_id = ? AND student_id = ?', [
          exam_subject_id,
          record.student_id,
        ]);

        // Approved marks are frozen against further teacher edits.
        if (existing?.status === 'APPROVED' && !req.permissions.has('marks.approve')) {
          continue;
        }

        const payload = {
          marks_obtained: record.is_absent ? null : record.marks_obtained,
          is_absent: record.is_absent ? 1 : 0,
          remarks: record.remarks,
          grade: record.is_absent ? null : await gradeFor(examSubject.campus_id, percentage),
          status: submit ? 'SUBMITTED' : 'DRAFT',
          entered_by: req.user.id,
          submitted_at: submit ? new Date().toISOString() : null,
        };

        if (existing) {
          await update('marks', existing.id, payload);
        } else {
          await insert('marks', {
            campus_id: examSubject.campus_id,
            examination_id: examSubject.examination_id,
            exam_subject_id,
            student_id: record.student_id,
            course_id: examSubject.course_id,
            max_marks: examSubject.max_marks,
            ...payload,
          });
        }
        saved += 1;
      }
      return { saved };
    })();

    // Submitting puts the batch in front of the administrators for approval.
    if (submit) {
      const approvers = (await all(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE r.code IN ('ADMINISTRATOR','ADMIN') AND u.campus_id = ? AND u.status = 'ACTIVE'`,
        [examSubject.campus_id]
      )).map((u) => u.id);
      await notifyMany(approvers, {
        campusId: examSubject.campus_id,
        type: 'MARKS_SUBMITTED',
        title: 'Marks submitted for approval',
        body: `${summary.saved} entries are awaiting your review.`,
        link: '/administrator/marks',
        entityType: 'ExamSubject',
        entityId: exam_subject_id,
      });
    }

    await logActivity({
      req,
      action: 'MARKS_UPDATE',
      module: 'marks',
      entityType: 'Exam Subject',
      entityId: exam_subject_id,
      description: `${submit ? 'Submitted' : 'Saved'} ${summary.saved} mark entries`,
      newValues: { exam_subject_id, count: summary.saved, status: submit ? 'SUBMITTED' : 'DRAFT' },
    });

    return created(res, { ...summary, status: submit ? 'SUBMITTED' : 'DRAFT' });
  })
);

/** Administrator reviews a submitted batch. */
router.post(
  '/marks/review',
  requirePermission('marks.approve'),
  validateBody(
    z.object({
      exam_subject_id: z.coerce.number().int().positive(),
      decision: z.enum(['APPROVED', 'REJECTED']),
      reason: z.string().max(400).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { exam_subject_id, decision, reason } = req.body;
    const examSubject = await get('SELECT * FROM exam_subjects WHERE id = ?', [exam_subject_id]);
    if (!examSubject) throw notFound('Exam subject not found');
    if (!isAdmin(req.user) && examSubject.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const pending = await all(`SELECT * FROM marks WHERE exam_subject_id = ? AND status = 'SUBMITTED'`, [exam_subject_id]);
    if (!pending.length) throw badRequest('There are no submitted marks awaiting review for this subject');

    await run(
      `UPDATE marks SET status = ?, approved_by = ?, approved_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'), rejection_reason = ?,
              updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        WHERE exam_subject_id = ? AND status = 'SUBMITTED'`,
      [decision, req.user.id, decision === 'REJECTED' ? reason ?? 'Returned for correction' : null, exam_subject_id]
    );

    // Tell the teacher who entered them.
    const enteredBy = [...new Set(pending.map((m) => m.entered_by).filter(Boolean))];
    await notifyMany(enteredBy, {
      campusId: examSubject.campus_id,
      type: 'MARKS_' + decision,
      title: `Marks ${decision.toLowerCase()}`,
      body:
        decision === 'APPROVED'
          ? 'Your submitted marks have been approved.'
          : `Your marks were returned: ${reason || 'please review and resubmit'}.`,
      link: '/faculty/teaching/marks',
      entityType: 'ExamSubject',
      entityId: exam_subject_id,
    });

    await logActivity({
      req,
      action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      module: 'marks',
      entityType: 'Exam Subject',
      entityId: exam_subject_id,
      description: `${decision} ${pending.length} mark entries`,
      oldValues: { status: 'SUBMITTED' },
      newValues: { status: decision, reason },
    });

    return ok(res, { exam_subject_id, decision, affected: pending.length });
  })
);

/** Batches waiting for an administrator's decision. */
router.get(
  '/marks/pending',
  requirePermission('marks.approve'),
  asyncHandler(async (req, res) => {
    const campusFilter = isAdmin(req.user) ? '' : ' AND m.campus_id = ?';
    const params = isAdmin(req.user) ? [] : [req.user.campus_id];
    const rows = await all(
      `SELECT es.id AS exam_subject_id, e.id AS examination_id, e.name AS exam_name,
              co.name AS course_name, sub.name AS subject_name, c.name AS class_name,
              COUNT(m.id) AS entries, MIN(m.submitted_at) AS submitted_at,
              MIN(eu.full_name) AS entered_by_name
         FROM marks m
         JOIN exam_subjects es ON es.id = m.exam_subject_id
         JOIN examinations e ON e.id = m.examination_id
         JOIN courses co ON co.id = m.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         LEFT JOIN users eu ON eu.id = m.entered_by
         LEFT JOIN classes c ON c.id = co.class_id
        WHERE m.status = 'SUBMITTED'${campusFilter}
        GROUP BY es.id, e.id, co.id, sub.id, c.id ORDER BY submitted_at`,
      params
    );
    return ok(res, rows);
  })
);

// ---------------------------------------------------------------- results
router.use(
  '/results',
  createResourceRouter({
    table: 'results',
    module: 'results',
    entityType: 'Result',
    alias: 'r',
    select: `r.*, s.first_name, s.last_name, s.admission_number, s.roll_number,
             e.name AS exam_name, e.exam_type, c.name AS class_name, sec.name AS section_name`,
    joins: `JOIN students s ON s.id = r.student_id
            JOIN examinations e ON e.id = r.examination_id
            LEFT JOIN classes c ON c.id = r.class_id
            LEFT JOIN sections sec ON sec.id = r.section_id`,
    searchable: ['s.first_name', 's.admission_number', 'e.name'],
    filterable: ['examination_id', 'student_id', 'class_id', 'section_id', 'result_status', 'published'],
    sortable: ['id', 'percentage', 'rank_in_class'],
    defaultSort: 'percentage',
    scopeClause: async (req) => {
      const allowed = await accessibleStudentIds(req.user);
      const clauses = [];
      const params = [];
      if (allowed !== null) {
        if (!allowed.length) return { clause: '1 = 0', params: [] };
        clauses.push(`r.student_id IN (${allowed.map(() => '?').join(',')})`);
        params.push(...allowed);
      }
      // Students and parents only ever see published results.
      if (isStudent(req.user) || isParent(req.user)) clauses.push('r.published = 1');
      return clauses.length ? { clause: clauses.join(' AND '), params } : null;
    },
  })
);

/** Full report card for one student in one examination. */
router.get(
  '/report-card/:examinationId/:studentId',
  requirePermission('results.view'),
  asyncHandler(async (req, res) => {
    const examinationId = Number(req.params.examinationId);
    const studentId = Number(req.params.studentId);
    await assertStudentAccess(req.user, studentId);

    const result = await get(
      `SELECT r.*, e.name AS exam_name, e.exam_type, e.start_date, e.end_date,
              s.first_name, s.last_name, s.admission_number, s.roll_number, s.photo, s.date_of_birth, s.board,
              c.name AS class_name, sec.name AS section_name, ay.name AS academic_year_name
         FROM results r
         JOIN examinations e ON e.id = r.examination_id
         JOIN students s ON s.id = r.student_id
         LEFT JOIN classes c ON c.id = r.class_id
         LEFT JOIN sections sec ON sec.id = r.section_id
         LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
        WHERE r.examination_id = ? AND r.student_id = ?`,
      [examinationId, studentId]
    );
    if (!result) throw notFound('No result has been generated for this student');
    if ((isStudent(req.user) || isParent(req.user)) && !result.published) {
      throw forbidden('This result has not been published yet');
    }

    const subjects = await all(
      `SELECT m.marks_obtained, m.max_marks, m.grade, m.is_absent, m.remarks,
              sub.name AS subject_name, co.name AS course_name, es.pass_marks
         FROM marks m
         JOIN exam_subjects es ON es.id = m.exam_subject_id
         JOIN courses co ON co.id = m.course_id
         JOIN subjects sub ON sub.id = co.subject_id
        WHERE m.examination_id = ? AND m.student_id = ? AND m.status = 'APPROVED'
        ORDER BY sub.name`,
      [examinationId, studentId]
    );

    const campus = await get(
      'SELECT name, address, city, state, pincode, phone, email, logo FROM campuses WHERE id = ?',
      [result.campus_id]
    );
    const gradeScale = await all('SELECT code, min_percent, max_percent, grade_point, remarks FROM grades WHERE campus_id = ? ORDER BY min_percent DESC', [
      result.campus_id,
    ]);

    return ok(res, { result, subjects, campus, gradeScale });
  })
);

export default router;
