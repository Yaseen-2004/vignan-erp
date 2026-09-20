/**
 * Faculty assignments — the office's view of who teaches and mentors whom.
 *
 * The pieces already existed, one record at a time: a course assignment links a
 * teacher to a subject in a section, `classes.class_teacher_id` names the class
 * teacher, and `students.mentor_id` names a mentor. Setting up a term through
 * those forms means dozens of separate saves.
 *
 * This router turns it around: pick a member of faculty, see everything they
 * hold, and assign a whole class or a set of students in one action. Nothing
 * here is a new kind of permission — it writes exactly the same three tables,
 * under the same permission codes, and every change is audited.
 *
 * Only Admin and Administrator reach it: the permissions below are ones the
 * teaching and financial roles do not hold.
 */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, scalar } from '../db/connection.js';
import { logActivity } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asyncHandler, ok } from '../lib/http.js';
import { notify } from '../lib/notify.js';
import { boardOf } from '../lib/scope.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

/**
 * The whole page is Admin and Administrator territory. `courses.manage` is the
 * cleanest expression of that: the two roles that arrange teaching hold it, and
 * teaching staff (who hold only `courses.view`) and financial staff (who hold
 * none) do not. Individual writes still carry the permission for the table they
 * touch, so nothing is granted by reaching this router alone.
 */
router.use(requirePermission('courses.manage'));

const loadFaculty = async (id) => {
  const faculty = await get(
    `SELECT f.*, u.full_name, u.email, u.id AS user_id
       FROM faculty f JOIN users u ON u.id = f.user_id
      WHERE f.id = ?`,
    [Number(id)]
  );
  if (!faculty) throw notFound('Faculty member not found');
  return faculty;
};

const assertTeaching = (faculty) => {
  if (faculty.staff_type !== 'TEACHING') {
    throw badRequest(`${faculty.full_name} is ${faculty.staff_type.toLowerCase()} staff and cannot be given a class.`);
  }
};

const currentYear = async (campusId) =>
  await get('SELECT id FROM academic_years WHERE is_current = 1 AND (campus_id = ? OR campus_id IS NULL) ORDER BY id DESC', [
    campusId,
  ]) || await get('SELECT id FROM academic_years ORDER BY id DESC LIMIT 1');

/* ===================================================================== */
/*  WHO IS AVAILABLE TO BE ASSIGNED                                      */
/* ===================================================================== */

/** Teaching staff with their current workload, for the picker. */
router.get(
  '/faculty',
  asyncHandler(async (req, res) => {
    const clauses = ["f.status = 'ACTIVE'", "f.staff_type = 'TEACHING'"];
    const params = [];

    // A department-confined Administrator arranges only their own wing;
    // teachers of the other department are not theirs to assign.
    const wing = await boardOf(req.user);
    if (wing) {
      clauses.push("(f.board = ? OR f.board = 'BOTH')");
      params.push(wing);
    }
    if (req.query.board && req.query.board !== 'ALL') {
      clauses.push('(f.board = ? OR f.board = \'BOTH\')');
      params.push(req.query.board);
    }
    if (req.query.search) {
      clauses.push('(u.full_name ILIKE ? OR f.faculty_code ILIKE ?)');
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }

    return ok(
      res,
      await all(
        `SELECT f.id, f.faculty_code, f.designation, f.board, u.full_name, u.photo, u.phone,
                d.name AS department,
                (SELECT COUNT(*) FROM course_assignments ca
                  WHERE ca.faculty_id = f.id AND ca.status = 'ACTIVE')        AS courses,
                (SELECT COUNT(*) FROM classes c WHERE c.class_teacher_id = f.id) AS classes_owned,
                (SELECT COUNT(*) FROM students s
                  WHERE s.mentor_id = f.id AND s.status = 'ACTIVE')            AS mentees
           FROM faculty f
           JOIN users u ON u.id = f.user_id
           LEFT JOIN departments d ON d.id = f.department_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY u.full_name`,
        params
      )
    );
  })
);

/* ===================================================================== */
/*  WHAT ONE MEMBER OF FACULTY HOLDS                                     */
/* ===================================================================== */

router.get(
  '/faculty/:id',
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);

    const courses = await all(
      `SELECT ca.id, ca.course_id, ca.section_id, ca.is_primary, ca.status,
              co.name AS course_name, co.code AS course_code, sub.name AS subject_name,
              c.name AS class_name, c.board, sec.name AS section_name,
              (SELECT COUNT(*) FROM students s
                WHERE s.section_id = sec.id AND s.status = 'ACTIVE') AS students
         FROM course_assignments ca
         JOIN courses co   ON co.id = ca.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         JOIN sections sec ON sec.id = ca.section_id
         JOIN classes c    ON c.id = sec.class_id
        WHERE ca.faculty_id = ? AND ca.status = 'ACTIVE'
        ORDER BY c.board, c.numeric_level, sec.name, sub.name`,
      [faculty.id]
    );

    const classesOwned = await all(
      `SELECT c.id AS class_id, c.name AS class_name, c.numeric_level, c.board, c.stream,
              (SELECT COUNT(*) FROM students s
                WHERE s.class_id = c.id AND s.status = 'ACTIVE') AS students
         FROM classes c
        WHERE c.class_teacher_id = ?
        ORDER BY c.board, c.numeric_level`,
      [faculty.id]
    );

    const mentees = await all(
      `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.roll_number, s.photo, s.board,
              c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN classes c    ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE s.mentor_id = ? AND s.status = 'ACTIVE'
        ORDER BY c.numeric_level, sec.name, s.first_name`,
      [faculty.id]
    );

    return ok(res, {
      faculty: {
        id: faculty.id,
        faculty_code: faculty.faculty_code,
        full_name: faculty.full_name,
        designation: faculty.designation,
        staff_type: faculty.staff_type,
        board: faculty.board,
        email: faculty.email,
      },
      courses,
      classesOwned,
      mentees: mentees.map((m) => ({ ...m, full_name: `${m.first_name} ${m.last_name || ''}`.trim() })),
    });
  })
);

/** Courses this teacher does not yet hold, to fill the assign dialog. */
router.get(
  '/faculty/:id/available-courses',
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);
    const clauses = ["co.status = 'ACTIVE'", "sec.status = 'ACTIVE'"];
    const params = [faculty.id];

    const wing = await boardOf(req.user);
    if (wing) {
      clauses.push('c.board = ?');
      params.push(wing);
    }
    if (req.query.board && req.query.board !== 'ALL') {
      clauses.push('c.board = ?');
      params.push(req.query.board);
    }
    if (req.query.class_id) {
      clauses.push('c.id = ?');
      params.push(req.query.class_id);
    }

    return ok(
      res,
      await all(
        `SELECT co.id AS course_id, co.name AS course_name, co.code AS course_code,
                sub.name AS subject_name, sec.id AS section_id, sec.name AS section_name,
                c.id AS class_id, c.name AS class_name, c.numeric_level, c.board,
                (SELECT COUNT(*) FROM students s
                  WHERE s.section_id = sec.id AND s.status = 'ACTIVE') AS students,
                tu.full_name AS taken_by
           FROM courses co
           JOIN subjects sub ON sub.id = co.subject_id
           JOIN classes c    ON c.id = co.class_id
           JOIN sections sec ON sec.class_id = c.id
           LEFT JOIN course_assignments other
                  ON other.course_id = co.id AND other.section_id = sec.id AND other.status = 'ACTIVE'
           LEFT JOIN faculty tf ON tf.id = other.faculty_id
           LEFT JOIN users tu   ON tu.id = tf.user_id
          WHERE ${clauses.join(' AND ')}
            AND NOT EXISTS (
              SELECT 1 FROM course_assignments mine
               WHERE mine.course_id = co.id AND mine.section_id = sec.id
                 AND mine.faculty_id = ? AND mine.status = 'ACTIVE')
          ORDER BY c.board, c.numeric_level, sec.name, sub.name`,
        [...params.slice(1), faculty.id]
      )
    );
  })
);

/* ===================================================================== */
/*  ASSIGN COURSES                                                       */
/* ===================================================================== */

router.post(
  '/faculty/:id/courses',
  requirePermission('courses.manage'),
  validateBody(
    z.object({
      items: z
        .array(z.object({ course_id: z.number().int().positive(), section_id: z.number().int().positive() }))
        .min(1, 'Choose at least one course'),
      is_primary: z.boolean().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);
    assertTeaching(faculty);

    const year = await currentYear(faculty.campus_id);
    if (!year) throw badRequest('No academic year is set up yet.');

    const added = [];
    for (const item of req.body.items) {
      // Skip anything already held rather than failing the whole batch.
      const existing = await get(
        `SELECT id FROM course_assignments
          WHERE course_id = ? AND section_id = ? AND faculty_id = ? AND status = 'ACTIVE'`,
        [item.course_id, item.section_id, faculty.id]
      );
      if (existing) continue;

      const newId = await insert('course_assignments', {
        course_id: item.course_id,
        section_id: item.section_id,
        faculty_id: faculty.id,
        academic_year_id: year.id,
        campus_id: faculty.campus_id,
        is_primary: req.body.is_primary === false ? 0 : 1,
        status: 'ACTIVE',
        assigned_by: req.user.id,
      });
      added.push(Number(newId));
    }

    if (added.length) {
      await notify({
        userId: faculty.user_id,
        campusId: faculty.campus_id,
        type: 'COURSE_ASSIGNED',
        title: added.length === 1 ? 'A course has been assigned to you' : `${added.length} courses assigned to you`,
        body: 'Open My Courses to see the classes you now teach.',
        link: '/faculty/teaching/courses',
      });
    }

    await logActivity({
      req,
      action: 'ASSIGN',
      module: 'courses',
      entityType: 'Faculty',
      entityId: faculty.id,
      description: `Assigned ${added.length} course(s) to ${faculty.full_name}`,
      newValues: { courses: req.body.items },
    });

    return ok(res, { assigned: added.length, skipped: req.body.items.length - added.length });
  })
);

router.delete(
  '/course-assignments/:assignmentId',
  requirePermission('courses.manage'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.assignmentId);
    const existing = await get(
      `SELECT ca.*, u.full_name AS faculty_name, co.name AS course_name
         FROM course_assignments ca
         JOIN faculty f ON f.id = ca.faculty_id
         JOIN users u   ON u.id = f.user_id
         JOIN courses co ON co.id = ca.course_id
        WHERE ca.id = ?`,
      [id]
    );
    if (!existing) throw notFound('Assignment not found');

    await run('DELETE FROM course_assignments WHERE id = ?', [id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'courses',
      entityType: 'Course Assignment',
      entityId: id,
      description: `Removed ${existing.course_name} from ${existing.faculty_name}`,
      oldValues: { course_id: existing.course_id, section_id: existing.section_id, faculty_id: existing.faculty_id },
    });
    return ok(res, { id, removed: true });
  })
);

/* ===================================================================== */
/*  CLASS TEACHER                                                        */
/* ===================================================================== */

/**
 * Naming a class teacher is what grants a teacher every subject and record of
 * that class, so the previous holder is recorded in the audit entry.
 */
router.post(
  '/faculty/:id/classes',
  requirePermission('academics.manage'),
  validateBody(z.object({ class_ids: z.array(z.number().int().positive()).min(1, 'Choose at least one class') })),
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);
    assertTeaching(faculty);

    const changed = [];
    for (const classId of req.body.class_ids) {
      const klass = await get(
        `SELECT c.id, c.name, c.class_teacher_id, u.full_name AS previous
           FROM classes c
           LEFT JOIN faculty pf ON pf.id = c.class_teacher_id
           LEFT JOIN users u    ON u.id = pf.user_id
          WHERE c.id = ?`,
        [classId]
      );
      if (!klass) throw badRequest(`Unknown class (${classId})`);
      if (klass.class_teacher_id === faculty.id) continue;

      await run("UPDATE classes SET class_teacher_id = ?, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [faculty.id, classId]);
      changed.push({ classId, name: klass.name, previous: klass.previous });

      await logActivity({
        req,
        action: 'ASSIGN',
        module: 'academics',
        entityType: 'Class',
        entityId: classId,
        description: `${faculty.full_name} made class teacher of ${klass.name}`,
        oldValues: { class_teacher: klass.previous ?? null },
        newValues: { class_teacher: faculty.full_name },
      });
    }

    if (changed.length) {
      await notify({
        userId: faculty.user_id,
        campusId: faculty.campus_id,
        type: 'CLASS_ASSIGNED',
        title: 'You are now a class teacher',
        body: `${changed.map((c) => c.name).join(', ')} — you can now see every subject and record of that class.`,
        link: '/faculty/teaching/students',
      });
    }

    return ok(res, { assigned: changed.length, replaced: changed.filter((c) => c.previous).length });
  })
);

router.delete(
  '/classes/:classId/class-teacher',
  requirePermission('academics.manage'),
  asyncHandler(async (req, res) => {
    const classId = Number(req.params.classId);
    const klass = await get(
      `SELECT c.id, c.name, c.class_teacher_id, u.full_name AS teacher
         FROM classes c
         LEFT JOIN faculty f ON f.id = c.class_teacher_id
         LEFT JOIN users u   ON u.id = f.user_id
        WHERE c.id = ?`,
      [classId]
    );
    if (!klass) throw notFound('Class not found');

    await run("UPDATE classes SET class_teacher_id = NULL, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [classId]);
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'academics',
      entityType: 'Class',
      entityId: classId,
      description: `Removed ${klass.teacher ?? 'the class teacher'} from ${klass.name}`,
      oldValues: { class_teacher: klass.teacher ?? null },
      newValues: { class_teacher: null },
    });
    return ok(res, { id: classId, removed: true });
  })
);

/* ===================================================================== */
/*  MENTEES                                                              */
/* ===================================================================== */

/** Students available to mentor, so a whole section can be handed over at once. */
router.get(
  '/students',
  asyncHandler(async (req, res) => {
    const clauses = ["s.status = 'ACTIVE'"];
    const params = [];

    const wing = await boardOf(req.user);
    if (wing) {
      clauses.push('s.board = ?');
      params.push(wing);
    }

    for (const [field, column] of [['class_id', 's.class_id'], ['section_id', 's.section_id'], ['board', 's.board']]) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        clauses.push(`${column} = ?`);
        params.push(req.query[field]);
      }
    }
    if (req.query.unassigned === 'true') clauses.push('s.mentor_id IS NULL');
    if (req.query.search) {
      clauses.push('(s.first_name ILIKE ? OR s.last_name ILIKE ? OR s.admission_number ILIKE ?)');
      const like = `%${req.query.search}%`;
      params.push(like, like, like);
    }

    return ok(
      res,
      (await all(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.roll_number, s.photo, s.board,
                s.mentor_id, c.name AS class_name, sec.name AS section_name,
                mu.full_name AS mentor_name
           FROM students s
           LEFT JOIN classes c    ON c.id = s.class_id
           LEFT JOIN sections sec ON sec.id = s.section_id
           LEFT JOIN faculty mf   ON mf.id = s.mentor_id
           LEFT JOIN users mu     ON mu.id = mf.user_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY c.numeric_level, sec.name, s.roll_number, s.first_name
          LIMIT 400`,
        params
      )).map((row) => ({ ...row, full_name: `${row.first_name} ${row.last_name || ''}`.trim() }))
    );
  })
);

router.post(
  '/faculty/:id/mentees',
  requirePermission('students.edit'),
  validateBody(
    z.object({ student_ids: z.array(z.number().int().positive()).min(1, 'Choose at least one student') })
  ),
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);
    assertTeaching(faculty);

    let assigned = 0;
    let reassigned = 0;
    for (const studentId of req.body.student_ids) {
      const student = await get(
        `SELECT s.id, s.first_name, s.last_name, s.mentor_id, s.user_id, s.campus_id, u.full_name AS previous
           FROM students s
           LEFT JOIN faculty pf ON pf.id = s.mentor_id
           LEFT JOIN users u    ON u.id = pf.user_id
          WHERE s.id = ?`,
        [studentId]
      );
      if (!student) throw badRequest(`Unknown student (${studentId})`);
      if (student.mentor_id === faculty.id) continue;

      await run("UPDATE students SET mentor_id = ?, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [faculty.id, studentId]);
      assigned += 1;
      if (student.mentor_id) reassigned += 1;

      await logActivity({
        req,
        action: 'ASSIGN',
        module: 'mentoring',
        entityType: 'Student',
        entityId: studentId,
        description: `${student.first_name} ${student.last_name || ''} assigned to mentor ${faculty.full_name}`.trim(),
        oldValues: { mentor: student.previous ?? null },
        newValues: { mentor: faculty.full_name },
      });
    }

    if (assigned) {
      await notify({
        userId: faculty.user_id,
        campusId: faculty.campus_id,
        type: 'MENTEE_ASSIGNED',
        title: assigned === 1 ? 'A mentee has been assigned to you' : `${assigned} mentees assigned to you`,
        body: 'Open My Mentees to see their attendance and results.',
        link: '/faculty/teaching/mentees',
      });
    }

    return ok(res, { assigned, reassigned });
  })
);

router.delete(
  '/faculty/:id/mentees/:studentId',
  requirePermission('students.edit'),
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);
    const studentId = Number(req.params.studentId);
    const student = await get('SELECT id, first_name, last_name, mentor_id FROM students WHERE id = ?', [studentId]);
    if (!student) throw notFound('Student not found');
    if (student.mentor_id !== faculty.id) throw badRequest('That student is not mentored by this member of faculty.');

    await run("UPDATE students SET mentor_id = NULL, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [studentId]);
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'mentoring',
      entityType: 'Student',
      entityId: studentId,
      description: `${student.first_name} ${student.last_name || ''} removed from ${faculty.full_name}`.trim(),
      oldValues: { mentor: faculty.full_name },
      newValues: { mentor: null },
    });
    return ok(res, { id: studentId, removed: true });
  })
);

/** Classes with no class teacher, and students with no mentor — the gaps. */
router.get(
  '/gaps',
  asyncHandler(async (req, res) =>
    ok(res, {
      classesWithoutTeacher: await all(
        `SELECT c.id, c.name, c.board, c.numeric_level FROM classes c
          WHERE c.class_teacher_id IS NULL AND c.status = 'ACTIVE'
            ${await boardOf(req.user) ? 'AND c.board = ?' : ''}
          ORDER BY c.board, c.numeric_level`,
        await boardOf(req.user) ? [await boardOf(req.user)] : []
      ),
      studentsWithoutMentor: Number(
        await scalar("SELECT COUNT(*) FROM students WHERE mentor_id IS NULL AND status = 'ACTIVE'") || 0
      ),
      coursesWithoutTeacher: Number(
        await scalar(
          `SELECT COUNT(*) FROM courses co
             JOIN classes c ON c.id = co.class_id
             JOIN sections sec ON sec.class_id = c.id
            WHERE co.status = 'ACTIVE'
              AND NOT EXISTS (SELECT 1 FROM course_assignments ca
                               WHERE ca.course_id = co.id AND ca.section_id = sec.id AND ca.status = 'ACTIVE')`
        ) || 0
      ),
    })
  )
);

export default router;
