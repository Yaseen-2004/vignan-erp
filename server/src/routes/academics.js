import { Router } from 'express';
import { z } from 'zod';
import { AcademicYear, Attendance, Campus, Class, Course, CourseAssignment, Department, Examination, Faculty, FeeCategory, Grade, InventoryCategory, Parent, Route, Section, Student, StudentFee, StudentParent, Subject, Timetable, Vehicle } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { lift, plain } from '../db/mongo/query.js';
import { sameId } from '../lib/scope.js';
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
    const student = await Student.findOne({ user_id: oid(req.user.id) }).select('section_id').lean();
    return student?.section_id ?? null;
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
    searchable: ['name', 'code', 'city'],
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
  counts: {
    class_count: { from: 'classes', on: 'academic_year_id' },
    enrollment_count: { from: 'enrollments', on: 'academic_year_id' },
  },
  searchable: ['name'],
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
    const id = req.params.id;
    const year = plain(await AcademicYear.findById(oid(id)));
    if (!year) throw notFound('Academic year not found');
    if (!isAdmin(req.user) && !sameId(year.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    /*
     * Exactly one year is current per campus, so the two writes are one act.
     * Between them no year is current at all, and anything that reads the
     * current year in that moment — an enrolment, a timetable — would find
     * none and refuse.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await AcademicYear.updateMany(
        { campus_id: oid(year.campus_id) },
        { $set: { is_current: 0 } },
        opts
      );
      await AcademicYear.updateOne(
        { _id: oid(id) },
        { $set: { is_current: 1, status: 'ACTIVE' } },
        opts
      );
    });

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
    /*
     * `head_faculty_id` is one of the four columns that hold an identifier
     * without naming its collection, so it is text and cannot be populated.
     * The head's name is resolved after the page is fetched.
     */
    counts: { faculty_count: { from: 'faculty', on: 'department_id' } },
    searchable: ['name', 'code'],
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
    populate: {
      academic_year_id: { name: 'academic_year_name' },
      'class_teacher_id.user_id': { full_name: 'class_teacher_name' },
    },
    counts: {
      section_count: { from: 'sections', on: 'class_id' },
      student_count: { from: 'students', on: 'class_id', where: { status: 'ACTIVE' } },
    },
    searchable: ['name', 'stream'],
    filterable: ['academic_year_id', 'status', 'board'],
    board: 'board',
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
    populate: {
      class_id: { name: 'class_name', board: 'board', academic_year_id: 'academic_year_id' },
      'section_teacher_id.user_id': { full_name: 'section_teacher_name' },
    },
    counts: {
      student_count: { from: 'students', on: 'section_id', where: { status: 'ACTIVE' } },
    },
    searchable: ['name'],
    filterable: ['class_id', 'status'],
    // A section's department is its class's.
    board: { via: 'class_id', field: 'board' },
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
    populate: { department_id: { name: 'department_name' } },
    counts: { course_count: { from: 'courses', on: 'subject_id' } },
    searchable: ['name', 'code'],
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
  populate: {
    subject_id: { name: 'subject_name', code: 'subject_code' },
    class_id: { name: 'class_name', board: 'board' },
    academic_year_id: { name: 'academic_year_name' },
  },
  counts: {
    assignment_count: { from: 'course_assignments', on: 'course_id', where: { status: 'ACTIVE' } },
    material_count: { from: 'course_materials', on: 'course_id' },
  },
  searchable: ['name', 'code'],
  filterable: ['class_id', 'subject_id', 'academic_year_id', 'status'],
  // A course's department is its class's.
  board: { via: 'class_id', field: 'board' },
  sortable: ['id', 'name', 'code'],
  required: ['code', 'name', 'subject_id', 'class_id', 'academic_year_id'],
  defaultSort: 'name',
  // A teacher only ever sees the courses assigned to them.
  scopeFilter: async (req) => {
    if (!isTeacher(req.user)) return null;
    const facultyId = await facultyIdOf(req.user);
    if (!facultyId) return { $expr: { $eq: [1, 0] } };
    const assigned = await CourseAssignment.find({ faculty_id: oid(facultyId), status: 'ACTIVE' })
      .select('course_id').lean();
    return { _id: { $in: assigned.map((a) => a.course_id).filter(Boolean) } };
  },
});

/** Students enrolled in a course (for the teacher's roster). */
coursesRouter.get(
  '/:id/students',
  requirePermission('courses.view', 'students.view'),
  asyncHandler(async (req, res) => {
    const courseId = req.params.id;
    const course = plain(await Course.findById(oid(courseId)));
    if (!course) throw notFound('Course not found');

    const filter = { class_id: oid(course.class_id), status: 'ACTIVE' };

    // A teacher sees the sections of this course they were actually given.
    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await CourseAssignment.find({
        course_id: oid(courseId),
        faculty_id: oid(facultyId),
        status: 'ACTIVE',
      }).select('section_id').lean();
      const sections = assigned.map((a) => a.section_id).filter(Boolean);
      if (!sections.length) throw forbidden('This course is not assigned to you');
      filter.section_id = { $in: sections };
    } else if (req.query.section_id) {
      filter.section_id = oid(req.query.section_id);
    }

    const students = lift(
      await Student.find(filter)
        .select('admission_number roll_number first_name last_name photo status section_id class_id')
        .populate('section_id', 'name')
        .populate('class_id', 'name'),
      { section_id: { name: 'section_name' }, class_id: { name: 'class_name' } }
    ).sort((a, b) => (Number(a.roll_number) || Infinity) - (Number(b.roll_number) || Infinity)
      || String(a.first_name ?? '').localeCompare(String(b.first_name ?? '')));

    return ok(res, students);
  })
);
router.use('/courses', coursesRouter);

// ------------------------------------------------------- course assignments
const assignmentsRouter = createResourceRouter({
  table: 'course_assignments',
  module: 'courses',
  entityType: 'Course Assignment',
  populate: {
    course_id: { name: 'course_name', code: 'course_code' },
    'course_id.subject_id': { name: 'subject_name' },
    faculty_id: { faculty_code: 'faculty_code' },
    'faculty_id.user_id': { full_name: 'faculty_name' },
    section_id: { name: 'section_name' },
    'section_id.class_id': { name: 'class_name', board: 'board' },
  },
  searchable: [],
  filterable: ['course_id', 'faculty_id', 'section_id', 'academic_year_id', 'status'],
  // An assignment's department is its section's class's.
  board: { via: 'section_id', field: 'board' },
  sortable: ['id'],
  required: ['course_id', 'faculty_id', 'section_id', 'academic_year_id'],
  permissions: { create: 'courses.manage', edit: 'courses.manage', delete: 'courses.manage' },
  beforeCreate: async (data, req) => {
    const faculty = await Faculty.findById(oid(data.faculty_id)).select('staff_type').lean();
    if (!faculty) throw badRequest('Unknown faculty member');
    if (faculty.staff_type !== 'TEACHING') throw badRequest('Only teaching staff can be assigned to a course');
    data.assigned_by = req.user.id;
    return data;
  },
  afterCreate: async (row) => {
    const faculty = await Faculty.findById(oid(row.faculty_id)).select('user_id campus_id').lean();
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
      const clash = await Timetable.findOne({
        faculty_id: oid(data.faculty_id),
        day_of_week: data.day_of_week,
        period: data.period,
        academic_year_id: oid(data.academic_year_id),
      })
        .populate('class_id', 'name')
        .populate('section_id', 'name');
      if (clash) {
        throw badRequest(
          `That teacher already has ${clash.class_id?.name ?? ''} ${clash.section_id?.name ?? ''} in this period`
        );
      }
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
    const teacher = await Faculty.findById(oid(row.faculty_id)).select('user_id campus_id').lean();
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
  const students = plain(
    await Student.find({ section_id: oid(row.section_id), status: 'ACTIVE' })
      .select('user_id campus_id')
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

  // DISTINCT mattered: a parent with two children in the section is told once.
  const links = await StudentParent.find({ student_id: { $in: students.map((x) => oid(x.id)) } })
    .select('parent_id').lean();
  const families = links.length
    ? await Parent.find({ _id: { $in: links.map((l) => l.parent_id) }, user_id: { $ne: null } })
      .select('user_id campus_id').lean()
    : [];
  const seen = new Set();
  const parents = families.filter((f) => {
    const key = String(f.user_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    const filter = {};

    if (req.query.section_id) {
      filter.section_id = oid(req.query.section_id);
    } else if (req.query.faculty_id) {
      filter.faculty_id = oid(req.query.faculty_id);
    } else if (isTeacher(req.user)) {
      filter.faculty_id = oid(await facultyIdOf(req.user));
    } else {
      const own = await ownSectionFor(req);
      if (own) filter.section_id = oid(own);
      else throw badRequest('Provide section_id or faculty_id');
    }

    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);

    /*
     * A section or teacher id is easy to guess, so the department is enforced
     * here rather than trusted from the caller. It lives on the class, so the
     * classes of that wing are resolved and the slots narrowed to them.
     */
    const wing = await boardOf(req.user);
    if (wing) {
      const classes = await Class.find({ board: wing }).select('_id').lean();
      filter.class_id = { $in: classes.map((c) => c._id) };
    }

    const rows = lift(
      await Timetable.find(filter)
        .populate({ path: 'course_id', select: 'name subject_id', populate: { path: 'subject_id', select: 'name' } })
        .populate({ path: 'faculty_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } })
        .populate('class_id', 'name')
        .populate('section_id', 'name')
        .sort({ day_of_week: 1, period: 1 }),
      {
        course_id: { name: 'course_name' },
        'course_id.subject_id': { name: 'subject_name' },
        'faculty_id.user_id': { full_name: 'faculty_name' },
        class_id: { name: 'class_name' },
        section_id: { name: 'section_name' },
      }
    );

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
    const campusId = isAdmin(req.user) && req.query.campus_id ? req.query.campus_id : req.user.campus_id;
    const scope = campusId ? { campus_id: oid(campusId) } : {};

    /*
     * These lists fill every select in the portal, so they honour the
     * department the person is assigned to: offering a class they cannot open
     * would only produce a refusal one click later.
     *
     * Where the department lives on the class rather than on the record —
     * sections, courses — the classes of that wing are resolved once and the
     * rest narrowed to them.
     */
    const wing = await boardOf(req.user);
    const wingClasses = wing
      ? await Class.find({ ...scope, board: wing }).select('_id').lean()
      : null;
    const withinWing = wingClasses ? { class_id: { $in: wingClasses.map((c) => c._id) } } : {};

    const rows = (docs) => plain(docs);

    const staffOfType = async (filter) => {
      const docs = await Faculty.find({ ...scope, ...filter, status: 'ACTIVE' })
        .select('faculty_code user_id')
        .populate('user_id', 'full_name');
      return lift(docs, { user_id: { full_name: 'full_name' } })
        .sort((a, b) => String(a.full_name ?? '').localeCompare(String(b.full_name ?? '')));
    };

    return ok(res, {
      // How many periods each weekday runs; 0 means the school is closed.
      periodsPerDay: await periodsPerDay(campusId),
      weekdays: WEEKDAYS,
      // The school's two departments (examination boards).
      boards: [
        { value: 'STATE', label: 'State Board' },
        { value: 'CBSE', label: 'CBSE' },
      ],

      campuses: rows(await Campus.find({}).select('code name').sort({ name: 1 })),

      academicYears: rows(
        await AcademicYear.find(scope).select('name is_current status').sort({ start_date: -1 })
      ),

      classes: rows(
        await Class.find({ ...scope, ...(wing ? { board: wing } : {}) })
          .select('name academic_year_id numeric_level board')
          .sort({ board: 1, numeric_level: 1, name: 1 })
      ),

      sections: lift(
        await Section.find({ ...scope, ...withinWing })
          .select('name class_id')
          .populate('class_id', 'name board')
          .sort({ name: 1 }),
        { class_id: { name: 'class_name', board: 'board' } }
      ).sort((a, b) => String(a.board ?? '').localeCompare(String(b.board ?? ''))
        || String(a.class_name ?? '').localeCompare(String(b.class_name ?? ''))
        || String(a.name ?? '').localeCompare(String(b.name ?? ''))),

      subjects: rows(await Subject.find(scope).select('code name type').sort({ name: 1 })),

      courses: lift(
        await Course.find({ ...scope, ...withinWing })
          .select('code name class_id subject_id')
          .populate('class_id', 'board')
          .sort({ name: 1 }),
        { class_id: { board: 'board' } }
      ),

      departments: rows(await Department.find(scope).select('code name').sort({ name: 1 })),
      teachingStaff: await staffOfType({ staff_type: 'TEACHING' }),
      financialStaff: await staffOfType({ staff_type: 'FINANCIAL' }),
      mentors: await staffOfType({ is_mentor: 1 }),

      feeCategories: rows(await FeeCategory.find(scope).select('code name').sort({ name: 1 })),
      examinations: rows(
        await Examination.find(scope).select('name exam_type status').sort({ start_date: -1 })
      ),
      routes: rows(await Route.find(scope).select('route_code name fare').sort({ name: 1 })),
      vehicles: rows(
        await Vehicle.find(scope).select('vehicle_number vehicle_type capacity').sort({ vehicle_number: 1 })
      ),
      grades: rows(
        await Grade.find(scope).select('code min_percent max_percent grade_point').sort({ min_percent: -1 })
      ),
      inventoryCategories: rows(
        await InventoryCategory.find(scope).select('code name').sort({ name: 1 })
      ),
    });
  })
);

export default router;
