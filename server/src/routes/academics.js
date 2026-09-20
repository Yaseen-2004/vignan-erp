import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, scalar } from '../db/connection.js';
import { asyncHandler, ok, created } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import { isAdmin, isTeacher, isStudent, isParent, facultyIdOf, childrenOf, boardOf } from '../lib/scope.js';
import { ROLES } from '../lib/permissions.js';
import { notify } from '../lib/notify.js';
import { periodsPerDay, periodsOnDay, WEEKDAYS } from '../lib/periods.js';

const router = Router();

/**
 * The section a student or parent is allowed to read a timetable for.
 * Returns null for staff (who may query any section).
 */
async function ownSectionFor(req) {
  if (isStudent(req.user)) {
    const student = await get('SELECT section_id FROM students WHERE user_id = ?', [req.user.id]);
    return student?.section_id ?? 0;
  }
  if (isParent(req.user)) {
    const children = await childrenOf(req.user);
    if (!children.length) return 0;
    const requested = Number(req.query.student_id);
    const child = requested ? children.find((c) => c.id === requested) : children[0];
    if (!child) throw forbidden('That student is not linked to your account');
    return child.section_id ?? 0;
  }
  return null;
}

// ---------------------------------------------------------------- campuses
router.use(
  '/campuses',
  requireRole(ROLES.ADMIN),
  createResourceRouter({
    table: 'campuses',
    module: 'campuses',
    entityType: 'Campus',
    alias: 'c',
    searchable: ['c.name', 'c.code', 'c.city'],
    filterable: ['status'],
    sortable: ['id', 'name', 'code'],
    required: ['code', 'name'],
    campusScoped: false,
    defaultSort: 'name',
  })
);

// ---------------------------------------------------------- academic years
const yearsRouter = createResourceRouter({
  table: 'academic_years',
  module: 'academics',
  entityType: 'Academic Year',
  alias: 'ay',
  select: `ay.*, (SELECT COUNT(*) FROM classes c WHERE c.academic_year_id = ay.id) AS class_count,
           (SELECT COUNT(*) FROM enrollments e WHERE e.academic_year_id = ay.id) AS enrollment_count`,
  searchable: ['ay.name'],
  filterable: ['status', 'is_current'],
  sortable: ['id', 'name', 'start_date'],
  required: ['name', 'start_date', 'end_date'],
  defaultSort: 'start_date',
});

/** Exactly one academic year may be current per campus. */
yearsRouter.post(
  '/:id/set-current',
  requirePermission('academics.manage'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const year = await get('SELECT * FROM academic_years WHERE id = ?', [id]);
    if (!year) throw notFound('Academic year not found');
    if (!isAdmin(req.user) && year.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    await run('UPDATE academic_years SET is_current = 0 WHERE campus_id = ?', [year.campus_id]);
    await run("UPDATE academic_years SET is_current = 1, status = 'ACTIVE' WHERE id = ?", [id]);

    await logActivity({
      req,
      action: 'UPDATE',
      module: 'academics',
      entityType: 'Academic Year',
      entityId: id,
      description: `Set ${year.name} as the current academic year`,
      newValues: { is_current: 1 },
    });
    return ok(res, { id, is_current: 1 });
  })
);
router.use('/academic-years', yearsRouter);

// ------------------------------------------------------------- departments
router.use(
  '/departments',
  createResourceRouter({
    table: 'departments',
    module: 'departments',
    entityType: 'Department',
    alias: 'd',
    select: `d.*, u.full_name AS head_name,
             (SELECT COUNT(*) FROM faculty f WHERE f.department_id = d.id) AS faculty_count`,
    joins: `LEFT JOIN faculty hf ON hf.id = d.head_faculty_id LEFT JOIN users u ON u.id = hf.user_id`,
    searchable: ['d.name', 'd.code'],
    filterable: ['status'],
    sortable: ['id', 'name', 'code'],
    required: ['code', 'name'],
    defaultSort: 'name',
  })
);

// ----------------------------------------------------------------- classes
router.use(
  '/classes',
  createResourceRouter({
    table: 'classes',
    module: 'academics',
    entityType: 'Class',
    alias: 'c',
    select: `c.*, ay.name AS academic_year_name, u.full_name AS class_teacher_name,
             (SELECT COUNT(*) FROM sections s WHERE s.class_id = c.id) AS section_count,
             (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.status = 'ACTIVE') AS student_count`,
    joins: `LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
            LEFT JOIN faculty f ON f.id = c.class_teacher_id
            LEFT JOIN users u ON u.id = f.user_id`,
    searchable: ['c.name', 'c.stream'],
    filterable: ['academic_year_id', 'status', 'board'],
    boardColumn: 'c.board',
    sortable: ['id', 'name', 'numeric_level'],
    required: ['name', 'academic_year_id'],
    defaultSort: 'numeric_level',
  })
);

// ---------------------------------------------------------------- sections
router.use(
  '/sections',
  createResourceRouter({
    table: 'sections',
    module: 'academics',
    entityType: 'Section',
    alias: 's',
    select: `s.*, c.name AS class_name, c.board, c.academic_year_id, u.full_name AS section_teacher_name,
             (SELECT COUNT(*) FROM students st WHERE st.section_id = s.id AND st.status = 'ACTIVE') AS student_count`,
    joins: `JOIN classes c ON c.id = s.class_id
            LEFT JOIN faculty f ON f.id = s.section_teacher_id
            LEFT JOIN users u ON u.id = f.user_id`,
    searchable: ['s.name', 'c.name'],
    filterable: ['class_id', 'status', { param: 'board', column: 'c.board' }],
    boardColumn: 'c.board',
    sortable: ['id', 'name'],
    required: ['name', 'class_id'],
    defaultSort: 'name',
  })
);

// ---------------------------------------------------------------- subjects
router.use(
  '/subjects',
  createResourceRouter({
    table: 'subjects',
    module: 'academics',
    entityType: 'Subject',
    alias: 's',
    select: `s.*, d.name AS department_name,
             (SELECT COUNT(*) FROM courses co WHERE co.subject_id = s.id) AS course_count`,
    joins: `LEFT JOIN departments d ON d.id = s.department_id`,
    searchable: ['s.name', 's.code'],
    filterable: ['type', 'status', 'department_id'],
    sortable: ['id', 'name', 'code'],
    required: ['code', 'name'],
    defaultSort: 'name',
  })
);

// ----------------------------------------------------------------- courses
const coursesRouter = createResourceRouter({
  table: 'courses',
  module: 'courses',
  entityType: 'Course',
  alias: 'co',
  select: `co.*, sub.name AS subject_name, sub.code AS subject_code, c.name AS class_name, c.board,
           ay.name AS academic_year_name,
           (SELECT COUNT(*) FROM course_assignments ca WHERE ca.course_id = co.id AND ca.status = 'ACTIVE') AS assignment_count,
           (SELECT COUNT(*) FROM course_materials cm WHERE cm.course_id = co.id) AS material_count`,
  joins: `JOIN subjects sub ON sub.id = co.subject_id
          JOIN classes c ON c.id = co.class_id
          JOIN academic_years ay ON ay.id = co.academic_year_id`,
  searchable: ['co.name', 'co.code', 'sub.name'],
  filterable: ['class_id', 'subject_id', 'academic_year_id', 'status', { param: 'board', column: 'c.board' }],
  boardColumn: 'c.board',
  sortable: ['id', 'name', 'code'],
  required: ['code', 'name', 'subject_id', 'class_id', 'academic_year_id'],
  defaultSort: 'name',
  // A teacher only ever sees the courses assigned to them.
  scopeClause: async (req) => {
    if (!isTeacher(req.user)) return null;
    const facultyId = await facultyIdOf(req.user);
    return {
      clause: `co.id IN (SELECT course_id FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE')`,
      params: [facultyId ?? 0],
    };
  },
});

/** Students enrolled in a course (for the teacher's roster). */
coursesRouter.get(
  '/:id/students',
  requirePermission('courses.view', 'students.view'),
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.id);
    const course = await get('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) throw notFound('Course not found');

    const params = [course.class_id];
    let sectionFilter = '';
    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const sections = (await all(
        `SELECT section_id FROM course_assignments WHERE course_id = ? AND faculty_id = ? AND status = 'ACTIVE'`,
        [courseId, facultyId ?? 0]
      )).map((r) => r.section_id);
      if (!sections.length) throw forbidden('This course is not assigned to you');
      sectionFilter = ` AND s.section_id IN (${sections.map(() => '?').join(',')})`;
      params.push(...sections);
    } else if (req.query.section_id) {
      sectionFilter = ' AND s.section_id = ?';
      params.push(req.query.section_id);
    }

    const students = await all(
      `SELECT s.id, s.admission_number, s.roll_number, s.first_name, s.last_name, s.photo, s.status,
              sec.name AS section_name, c.name AS class_name
         FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.class_id = ? AND s.status = 'ACTIVE'${sectionFilter}
        ORDER BY s.roll_number, s.first_name`,
      params
    );
    return ok(res, students);
  })
);
router.use('/courses', coursesRouter);

// ------------------------------------------------------- course assignments
const assignmentsRouter = createResourceRouter({
  table: 'course_assignments',
  module: 'courses',
  entityType: 'Course Assignment',
  alias: 'ca',
  select: `ca.*, co.name AS course_name, co.code AS course_code, sub.name AS subject_name,
           u.full_name AS faculty_name, f.faculty_code, sec.name AS section_name, c.name AS class_name, c.board`,
  joins: `JOIN courses co ON co.id = ca.course_id
          JOIN subjects sub ON sub.id = co.subject_id
          JOIN faculty f ON f.id = ca.faculty_id
          JOIN users u ON u.id = f.user_id
          JOIN sections sec ON sec.id = ca.section_id
          JOIN classes c ON c.id = sec.class_id`,
  searchable: ['co.name', 'u.full_name'],
  filterable: ['course_id', 'faculty_id', 'section_id', 'academic_year_id', 'status', { param: 'board', column: 'c.board' }],
  boardColumn: 'c.board',
  sortable: ['id'],
  required: ['course_id', 'faculty_id', 'section_id', 'academic_year_id'],
  permissions: { create: 'courses.manage', edit: 'courses.manage', delete: 'courses.manage' },
  beforeCreate: async (data, req) => {
    const faculty = await get('SELECT * FROM faculty WHERE id = ?', [data.faculty_id]);
    if (!faculty) throw badRequest('Unknown faculty member');
    if (faculty.staff_type !== 'TEACHING') throw badRequest('Only teaching staff can be assigned to a course');
    data.assigned_by = req.user.id;
    return data;
  },
  afterCreate: async (row) => {
    const faculty = await get('SELECT user_id, campus_id FROM faculty WHERE id = ?', [row.faculty_id]);
    if (faculty) {
      await notify({
        userId: faculty.user_id,
        campusId: faculty.campus_id,
        type: 'COURSE_ASSIGNED',
        title: 'New course assigned',
        body: `${row.course_name} — ${row.class_name} ${row.section_name}`,
        link: '/faculty/teaching/courses',
        entityType: 'Course',
        entityId: row.course_id,
      });
    }
  },
});
router.use('/course-assignments', assignmentsRouter);

// ------------------------------------------------------------- enrollments
router.use(
  '/enrollments',
  createResourceRouter({
    table: 'enrollments',
    module: 'enrollments',
    entityType: 'Enrollment',
    alias: 'e',
    select: `e.*, s.first_name, s.last_name, s.admission_number, c.name AS class_name, c.board,
             sec.name AS section_name, ay.name AS academic_year_name`,
    joins: `JOIN students s ON s.id = e.student_id
            JOIN classes c ON c.id = e.class_id
            JOIN sections sec ON sec.id = e.section_id
            JOIN academic_years ay ON ay.id = e.academic_year_id`,
    searchable: ['s.first_name', 's.admission_number'],
    filterable: ['student_id', 'academic_year_id', 'class_id', 'section_id', 'status', { param: 'board', column: 'c.board' }],
    boardColumn: 'c.board',
    sortable: ['id', 'enrollment_date'],
    required: ['student_id', 'academic_year_id', 'class_id', 'section_id'],
  })
);

// -------------------------------------------------------------- timetables
const timetableRouter = createResourceRouter({
  table: 'timetables',
  module: 'timetable',
  entityType: 'Timetable Slot',
  alias: 't',
  select: `t.*, co.name AS course_name, co.code AS course_code, sub.name AS subject_name,
           u.full_name AS faculty_name, c.name AS class_name, sec.name AS section_name`,
  joins: `LEFT JOIN courses co ON co.id = t.course_id
          LEFT JOIN subjects sub ON sub.id = co.subject_id
          LEFT JOIN faculty f ON f.id = t.faculty_id
          LEFT JOIN users u ON u.id = f.user_id
          LEFT JOIN classes c ON c.id = t.class_id
          LEFT JOIN sections sec ON sec.id = t.section_id`,
  searchable: ['co.name', 'u.full_name'],
  filterable: [
    'class_id', 'section_id', 'faculty_id', 'day_of_week', 'academic_year_id',
    { param: 'board', column: 'c.board' },
  ],
  boardColumn: 'c.board',
  sortable: ['id', 'day_of_week', 'period'],
  required: ['class_id', 'section_id', 'day_of_week', 'period', 'start_time', 'end_time'],
  defaultSort: 'day_of_week',
  beforeCreate: async (data, req) => {
    // A period beyond what the day runs would sit outside every timetable grid.
    const available = await periodsOnDay(req.user.campus_id, data.day_of_week);
    const dayName = WEEKDAYS.find((d) => d.day === Number(data.day_of_week))?.name ?? 'That day';
    if (!available) {
      throw badRequest(`${dayName} has no teaching periods. Set them in System Settings first.`);
    }
    if (Number(data.period) < 1 || Number(data.period) > available) {
      throw badRequest(`${dayName} runs ${available} period(s), so period ${data.period} does not exist.`);
    }

    // A teacher cannot be in two rooms during the same period.
    if (data.faculty_id) {
      const clash = await get(
        `SELECT t.id, c.name AS class_name, sec.name AS section_name FROM timetables t
           JOIN classes c ON c.id = t.class_id JOIN sections sec ON sec.id = t.section_id
          WHERE t.faculty_id = ? AND t.day_of_week = ? AND t.period = ? AND t.academic_year_id = ?`,
        [data.faculty_id, data.day_of_week, data.period, data.academic_year_id]
      );
      if (clash) throw badRequest(`That teacher already has ${clash.class_name} ${clash.section_name} in this period`);
    }
    return data;
  },
  afterCreate: async (row) => await announceTimetable(row),
  afterUpdate: async (row) => await announceTimetable(row),
});

/**
 * A timetable is only useful once the people who follow it know about it.
 *
 * Setting a slot therefore reaches all three audiences at once, each pointed at
 * the page in their own portal: the teacher who has to be in the room, the
 * pupils of that section, and their parents.
 */
async function announceTimetable(row) {
  if (!row) return;
  const where = `${row.class_name || ''} ${row.section_name || ''}`.trim();
  const subject = row.subject_name || row.course_name;

  // The teacher standing in front of the class.
  if (row.faculty_id) {
    const teacher = await get('SELECT user_id, campus_id FROM faculty WHERE id = ?', [row.faculty_id]);
    if (teacher?.user_id) {
      await notify({
        userId: teacher.user_id,
        campusId: teacher.campus_id,
        type: 'TIMETABLE_UPDATED',
        title: 'Your timetable has changed',
        body: `${where}${subject ? ` · ${subject}` : ''} — period ${row.period}.`,
        link: '/faculty/teaching/timetable',
        entityType: 'Timetable',
        entityId: row.id,
      });
    }
  }

  // The pupils who sit in it, and the parents who plan around it.
  const students = await all(
    `SELECT s.id, s.user_id, s.campus_id FROM students s
      WHERE s.section_id = ? AND s.status = 'ACTIVE'`,
    [row.section_id]
  );
  if (!students.length) return;

  const body = `${where} timetable has changed.`;
  for (const student of students) {
    if (student.user_id) {
      await notify({
        userId: student.user_id,
        campusId: student.campus_id,
        type: 'TIMETABLE_UPDATED',
        title: 'Timetable updated',
        body,
        link: '/parent/timetable',
        entityType: 'Timetable',
        entityId: row.id,
      });
    }
  }

  const parents = await all(
    `SELECT DISTINCT p.user_id, p.campus_id
       FROM student_parents sp
       JOIN parents p ON p.id = sp.parent_id
      WHERE sp.student_id IN (${students.map(() => '?').join(',')}) AND p.user_id IS NOT NULL`,
    students.map((student) => student.id)
  );
  for (const parent of parents) {
    await notify({
      userId: parent.user_id,
      campusId: parent.campus_id,
      type: 'TIMETABLE_UPDATED',
      title: 'Timetable updated',
      body,
      link: '/parent/timetable',
      entityType: 'Timetable',
      entityId: row.id,
    });
  }
}

/** Weekly grid for a section (or a teacher), ready to render. */
timetableRouter.get(
  '/grid',
  requirePermission('timetable.view'),
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];

    // Students and parents are pinned to their own (or their child's) section.
    const ownSection = await ownSectionFor(req);
    if (ownSection !== null) {
      clauses.push('t.section_id = ?');
      params.push(ownSection);
    } else {
      if (req.query.section_id) {
        clauses.push('t.section_id = ?');
        params.push(req.query.section_id);
      }
      if (req.query.faculty_id) {
        clauses.push('t.faculty_id = ?');
        params.push(req.query.faculty_id);
      }
      // A teacher without an explicit filter sees their own timetable.
      if (!clauses.length && isTeacher(req.user)) {
        clauses.push('t.faculty_id = ?');
        params.push(await facultyIdOf(req.user) ?? 0);
      }
      if (!clauses.length) throw badRequest('Provide section_id or faculty_id');
    }
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('t.campus_id = ?');
      params.push(req.user.campus_id);
    }
    // A section or teacher id is easy to guess, so the department is enforced
    // here too rather than trusted from the caller.
    const wing = await boardOf(req.user);
    if (wing) {
      clauses.push('c.board = ?');
      params.push(wing);
    }

    const rows = await all(
      `SELECT t.*, co.name AS course_name, sub.name AS subject_name, u.full_name AS faculty_name,
              c.name AS class_name, sec.name AS section_name
         FROM timetables t
         LEFT JOIN courses co ON co.id = t.course_id
         LEFT JOIN subjects sub ON sub.id = co.subject_id
         LEFT JOIN faculty f ON f.id = t.faculty_id
         LEFT JOIN users u ON u.id = f.user_id
         LEFT JOIN classes c ON c.id = t.class_id
         LEFT JOIN sections sec ON sec.id = t.section_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.day_of_week, t.period`,
      params
    );

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const grid = days.map((name, index) => ({
      day: index + 1,
      name,
      slots: rows.filter((r) => r.day_of_week === index + 1),
    }));
    const periods = [...new Set(rows.map((r) => r.period))].sort((a, b) => a - b);
    return ok(res, { grid, periods, slots: rows });
  })
);
router.use('/timetable', timetableRouter);

// -------------------------------------------------------------- grade bands
router.use(
  '/grades',
  createResourceRouter({
    table: 'grades',
    module: 'examinations',
    entityType: 'Grade',
    alias: 'g',
    searchable: ['g.code', 'g.name'],
    sortable: ['id', 'min_percent', 'code'],
    required: ['code', 'min_percent', 'max_percent'],
    defaultSort: 'min_percent',
  })
);

/**
 * The two departments the school runs, each with its own head-count and
 * workload. This is what the Departments landing page is built from: pick a
 * wing, then work inside it.
 */
router.get(
  '/departments/overview',
  requirePermission('academics.view', 'students.view'),
  asyncHandler(async (req, res) => {
    const campusId = isAdmin(req.user) && req.query.campus_id ? Number(req.query.campus_id) : req.user.campus_id;
    const scope = campusId ? ' AND campus_id = ?' : '';
    const p = campusId ? [campusId] : [];

    const boards = [
      { board: 'STATE', label: 'State Board', description: 'Karnataka State syllabus · Kannada first language' },
      { board: 'CBSE', label: 'CBSE', description: 'National curriculum · Hindi first language' },
    ];

    // A restricted Administrator sees only their own wing here.
    const confinedTo = await boardOf(req.user);
    const overview = await Promise.all(boards
      .filter((entry) => !confinedTo || entry.board === confinedTo)
      .map(async (entry) => {
      const params = [entry.board, ...p];

      const students = Number(
        await scalar(`SELECT COUNT(*) AS n FROM students WHERE board = ? AND status = 'ACTIVE'${scope}`, params) || 0
      );
      const classes = Number(
        await scalar(`SELECT COUNT(*) AS n FROM classes WHERE board = ? AND status = 'ACTIVE'${scope}`, params) || 0
      );
      const sections = Number(
        await scalar(
          `SELECT COUNT(*) AS n FROM sections sec JOIN classes c ON c.id = sec.class_id
            WHERE c.board = ? AND sec.status = 'ACTIVE'${scope ? ' AND sec.campus_id = ?' : ''}`,
          params
        ) || 0
      );
      const courses = Number(
        await scalar(
          `SELECT COUNT(*) AS n FROM courses co JOIN classes c ON c.id = co.class_id
            WHERE c.board = ? AND co.status = 'ACTIVE'${scope ? ' AND co.campus_id = ?' : ''}`,
          params
        ) || 0
      );
      const teachers = Number(
        await scalar(
          `SELECT COUNT(*) AS n FROM faculty
            WHERE staff_type = 'TEACHING' AND status = 'ACTIVE'
              AND (board = ? OR board = 'BOTH')${scope}`,
          params
        ) || 0
      );

      const attendance = await get(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) AS present
           FROM attendance a JOIN students s ON s.id = a.student_id
          WHERE s.board = ? AND substr(a.attendance_date, 1, 10) >= to_char((now() AT TIME ZONE 'UTC') + interval '-30 days', 'YYYY-MM-DD')
            ${scope ? ' AND a.campus_id = ?' : ''}`,
        params
      );

      const fees = await get(
        `SELECT COALESCE(SUM(sf.total_amount - sf.discount_amount), 0) AS billed,
                COALESCE(SUM(sf.paid_amount), 0) AS collected,
                COALESCE(SUM(sf.total_amount - sf.discount_amount - sf.paid_amount), 0) AS pending
           FROM student_fees sf JOIN students s ON s.id = sf.student_id
          WHERE s.board = ?${scope ? ' AND sf.campus_id = ?' : ''}`,
        params
      );

      const classList = await all(
        `SELECT c.id, c.name, c.numeric_level,
                (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.status = 'ACTIVE') AS students
           FROM classes c
          WHERE c.board = ? AND c.status = 'ACTIVE'${scope ? ' AND c.campus_id = ?' : ''}
          ORDER BY c.numeric_level`,
        params
      );

      return {
        ...entry,
        students,
        classes,
        sections,
        courses,
        teachers,
        attendancePercent: attendance?.total
          ? Number(((attendance.present / attendance.total) * 100).toFixed(1))
          : null,
        fees,
        classList,
      };
    }));

    return ok(res, overview);
  })
);

/**
 * Lookup bundle for form dropdowns — one round trip instead of eight.
 *
 * These lists fill every select in the app, so they honour the department the
 * user is assigned to: offering a class they cannot open would only produce a
 * refusal one click later.
 */
router.get(
  '/lookups',
  asyncHandler(async (req, res) => {
    const campusId = isAdmin(req.user) && req.query.campus_id ? Number(req.query.campus_id) : req.user.campus_id;
    const scope = campusId ? ' WHERE campus_id = ?' : '';
    const params = campusId ? [campusId] : [];

    // Appends ` AND c.board = ?` (or ` WHERE ...`) when the user is confined.
    const wing = await boardOf(req.user);
    const confine = (column, alreadyFiltered) =>
      wing ? `${alreadyFiltered ? ' AND' : ' WHERE'} ${column} = '${wing}'` : '';

    return ok(res, {
      // How many periods each weekday runs; 0 means the school is closed.
      periodsPerDay: await periodsPerDay(campusId),
      weekdays: WEEKDAYS,
      // The school's two departments (examination boards).
      boards: [
        { value: 'STATE', label: 'State Board' },
        { value: 'CBSE', label: 'CBSE' },
      ],
      campuses: await all('SELECT id, code, name FROM campuses ORDER BY name'),
      academicYears: await all(`SELECT id, name, is_current, status FROM academic_years${scope} ORDER BY start_date DESC`, params),
      classes: await all(
        `SELECT c.id, c.name, c.academic_year_id, c.numeric_level, c.board FROM classes c
          ${campusId ? 'WHERE c.campus_id = ?' : ''}${confine('c.board', !!campusId)}
          ORDER BY c.board, c.numeric_level, c.name`,
        params
      ),
      sections: await all(
        `SELECT s.id, s.name, s.class_id, c.name AS class_name, c.board FROM sections s
           JOIN classes c ON c.id = s.class_id ${campusId ? 'WHERE s.campus_id = ?' : ''}${confine('c.board', !!campusId)}
          ORDER BY c.board, c.name, s.name`,
        params
      ),
      subjects: await all(`SELECT id, code, name, type FROM subjects${scope} ORDER BY name`, params),
      courses: await all(
        `SELECT co.id, co.code, co.name, co.class_id, co.subject_id, c.board FROM courses co
           JOIN classes c ON c.id = co.class_id
          ${campusId ? 'WHERE co.campus_id = ?' : ''}${confine('c.board', !!campusId)} ORDER BY co.name`,
        params
      ),
      departments: await all(`SELECT id, code, name FROM departments${scope} ORDER BY name`, params),
      teachingStaff: await all(
        `SELECT f.id, f.faculty_code, u.full_name FROM faculty f JOIN users u ON u.id = f.user_id
          WHERE f.staff_type = 'TEACHING' AND f.status = 'ACTIVE'${campusId ? ' AND f.campus_id = ?' : ''}
          ORDER BY u.full_name`,
        params
      ),
      financialStaff: await all(
        `SELECT f.id, f.faculty_code, u.full_name FROM faculty f JOIN users u ON u.id = f.user_id
          WHERE f.staff_type = 'FINANCIAL' AND f.status = 'ACTIVE'${campusId ? ' AND f.campus_id = ?' : ''}
          ORDER BY u.full_name`,
        params
      ),
      mentors: await all(
        `SELECT f.id, f.faculty_code, u.full_name FROM faculty f JOIN users u ON u.id = f.user_id
          WHERE f.is_mentor = 1 AND f.status = 'ACTIVE'${campusId ? ' AND f.campus_id = ?' : ''} ORDER BY u.full_name`,
        params
      ),
      feeCategories: await all(`SELECT id, code, name FROM fee_categories${scope} ORDER BY name`, params),
      examinations: await all(
        `SELECT id, name, exam_type, status FROM examinations${scope} ORDER BY start_date DESC`,
        params
      ),
      routes: await all(`SELECT id, route_code, name, fare FROM routes${scope} ORDER BY name`, params),
      vehicles: await all(`SELECT id, vehicle_number, vehicle_type, capacity FROM vehicles${scope} ORDER BY vehicle_number`, params),
      grades: await all(`SELECT id, code, min_percent, max_percent, grade_point FROM grades${scope} ORDER BY min_percent DESC`, params),
      inventoryCategories: await all(`SELECT id, code, name FROM inventory_categories${scope} ORDER BY name`, params),
    });
  })
);

export default router;
