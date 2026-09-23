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
import { AcademicYear, Class, Course, CourseAssignment, Faculty, Section, Student, User } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { escapeRegex, lift, plain } from '../db/mongo/query.js';
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
  const doc = await Faculty.findById(oid(id)).populate('user_id', 'full_name email');
  if (!doc) throw notFound('Faculty member not found');
  // `user_id` stays the account's id, as the SQL aliased u.id to it.
  return lift(doc, { user_id: { full_name: 'full_name', email: 'email' } });
};

const assertTeaching = (faculty) => {
  if (faculty.staff_type !== 'TEACHING') {
    throw badRequest(`${faculty.full_name} is ${faculty.staff_type.toLowerCase()} staff and cannot be given a class.`);
  }
};

const currentYear = async (campusId) =>
  await AcademicYear.findOne({
    is_current: 1,
    $or: [{ campus_id: oid(campusId) }, { campus_id: null }],
  }).sort({ _id: -1 }).select('_id').lean()
  // Any year at all is better than refusing the whole page when none is
  // marked current — which is what the second query was for.
  || await AcademicYear.findOne({}).sort({ _id: -1 }).select('_id').lean();


/** Classes with nobody leading them, within the caller's department. */
async function classesWithoutTeacher(req) {
  const wing = await boardOf(req.user);
  const filter = { class_teacher_id: null, status: 'ACTIVE' };
  if (wing) filter.board = wing;
  return plain(
    await Class.find(filter).select('name board numeric_level').sort({ board: 1, numeric_level: 1 })
  );
}

/**
 * Course-and-section pairs with nobody teaching them.
 *
 * NOT EXISTS over a join of courses to their class's sections: every section
 * of the class a course belongs to needs someone, and the pairs already taken
 * are subtracted.
 */
async function coursesWithoutTeacher() {
  const courses = await Course.find({ status: 'ACTIVE' }).select('class_id').lean();
  if (!courses.length) return 0;

  const sections = await Section.find({ class_id: { $in: courses.map((c) => c.class_id) } })
    .select('class_id').lean();
  const sectionsOf = new Map();
  for (const section of sections) {
    const key = String(section.class_id);
    if (!sectionsOf.has(key)) sectionsOf.set(key, []);
    sectionsOf.get(key).push(section._id);
  }

  const taken = new Set(
    (await CourseAssignment.find({ status: 'ACTIVE' }).select('course_id section_id').lean())
      .map((a) => `${a.course_id}:${a.section_id}`)
  );

  let open = 0;
  for (const course of courses) {
    for (const sectionId of sectionsOf.get(String(course.class_id)) ?? []) {
      if (!taken.has(`${course._id}:${sectionId}`)) open += 1;
    }
  }
  return open;
}

/* ===================================================================== */
/*  WHO IS AVAILABLE TO BE ASSIGNED                                      */
/* ===================================================================== */

/** Teaching staff with their current workload, for the picker. */
router.get(
  '/faculty',
  asyncHandler(async (req, res) => {

    // A department-confined Administrator arranges only their own wing;
    // teachers of the other department are not theirs to assign.
    const wing = await boardOf(req.user);
    /*
     * A member of staff assigned to one wing, or to both, is available to it.
     * The department ceiling narrows first and the query's own ?board= may
     * narrow further, but never past it.
     */
    const filter = {};
    const wings = [wing, req.query.board && req.query.board !== 'ALL' ? req.query.board : null]
      .filter(Boolean);
    if (wings.length) {
      filter.$and = wings.map((w) => ({ board: { $in: [w, 'BOTH'] } }));
    }

    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      const accounts = await User.find({ full_name: term }).select('_id').lean();
      filter.$or = [
        { faculty_code: term },
        { user_id: { $in: accounts.map((u) => u._id) } },
      ];
    }

    const docs = await Faculty.find({ ...filter, staff_type: 'TEACHING', status: 'ACTIVE' })
      .select('faculty_code designation board user_id department_id')
      .populate('user_id', 'full_name photo phone')
      .populate('department_id', 'name');

    // Three correlated subqueries per member of staff became three grouped
    // queries for the whole list.
    const ids = docs.map((d) => d._id);
    const countBy = async (Model, field, extra = {}) => {
      const rows = await Model.aggregate([
        { $match: { [field]: { $in: ids }, ...extra } },
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      ]);
      return new Map(rows.map((r) => [String(r._id), r.n]));
    };
    const [courses, owned, mentees] = await Promise.all([
      countBy(CourseAssignment, 'faculty_id', { status: 'ACTIVE' }),
      countBy(Class, 'class_teacher_id'),
      countBy(Student, 'mentor_id', { status: 'ACTIVE' }),
    ]);

    return ok(res, lift(docs, {
      user_id: { full_name: 'full_name', photo: 'photo', phone: 'phone' },
      department_id: { name: 'department' },
    }).map((row) => ({
      ...row,
      courses: courses.get(row.id) ?? 0,
      classes_owned: owned.get(row.id) ?? 0,
      mentees: mentees.get(row.id) ?? 0,
    })));
  })
);

/* ===================================================================== */
/*  WHAT ONE MEMBER OF FACULTY HOLDS                                     */
/* ===================================================================== */

router.get(
  '/faculty/:id',
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);

    /*
     * What they teach, which classes they lead, and who they mentor.
     *
     * Each was a query with its own count of pupils attached. The counts are
     * done once, by section and by class, rather than once per row.
     */
    const assignments = await CourseAssignment.find({ faculty_id: oid(faculty.id), status: 'ACTIVE' })
      .select('course_id section_id is_primary status')
      .populate({ path: 'course_id', select: 'name code subject_id', populate: { path: 'subject_id', select: 'name' } })
      .populate({ path: 'section_id', select: 'name class_id', populate: { path: 'class_id', select: 'name board numeric_level' } });

    const pupilsBySection = new Map(
      (await Student.aggregate([
        { $match: { section_id: { $in: assignments.map((a) => a.section_id?._id).filter(Boolean) }, status: 'ACTIVE' } },
        { $group: { _id: '$section_id', n: { $sum: 1 } } },
      ])).map((r) => [String(r._id), r.n])
    );

    const courses = assignments
      .map((a) => ({
        id: String(a._id),
        course_id: a.course_id ? String(a.course_id._id) : null,
        section_id: a.section_id ? String(a.section_id._id) : null,
        is_primary: a.is_primary,
        status: a.status,
        course_name: a.course_id?.name ?? null,
        course_code: a.course_id?.code ?? null,
        subject_name: a.course_id?.subject_id?.name ?? null,
        class_name: a.section_id?.class_id?.name ?? null,
        board: a.section_id?.class_id?.board ?? null,
        section_name: a.section_id?.name ?? null,
        students: pupilsBySection.get(String(a.section_id?._id)) ?? 0,
        _level: a.section_id?.class_id?.numeric_level ?? 0,
      }))
      .sort((a, b) => String(a.board ?? '').localeCompare(String(b.board ?? ''))
        || a._level - b._level
        || String(a.section_name ?? '').localeCompare(String(b.section_name ?? ''))
        || String(a.subject_name ?? '').localeCompare(String(b.subject_name ?? '')))
      .map(({ _level, ...row }) => row);

    const ownedDocs = await Class.find({ class_teacher_id: oid(faculty.id) })
      .select('name numeric_level board stream');
    const pupilsByClass = new Map(
      (await Student.aggregate([
        { $match: { class_id: { $in: ownedDocs.map((c) => c._id) }, status: 'ACTIVE' } },
        { $group: { _id: '$class_id', n: { $sum: 1 } } },
      ])).map((r) => [String(r._id), r.n])
    );
    const classesOwned = ownedDocs
      .map((c) => ({
        class_id: String(c._id),
        class_name: c.name,
        numeric_level: c.numeric_level,
        board: c.board,
        stream: c.stream,
        students: pupilsByClass.get(String(c._id)) ?? 0,
      }))
      .sort((a, b) => String(a.board ?? '').localeCompare(String(b.board ?? ''))
        || (a.numeric_level ?? 0) - (b.numeric_level ?? 0));

    const mentees = lift(
      await Student.find({ mentor_id: oid(faculty.id), status: 'ACTIVE' })
        .select('first_name last_name admission_number roll_number photo board class_id section_id')
        .populate('class_id', 'name')
        .populate('section_id', 'name'),
      { class_id: { name: 'class_name' }, section_id: { name: 'section_name' } }
    );

  })
);

/** Courses this teacher does not yet hold, to fill the assign dialog. */
router.get(
  '/faculty/:id/available-courses',
  asyncHandler(async (req, res) => {
    const faculty = await loadFaculty(req.params.id);
    // The department ceiling first; the query may narrow within it.
    const classFilter = {};
    const wing = await boardOf(req.user);
    if (wing) classFilter.board = wing;
    if (req.query.board && req.query.board !== 'ALL') classFilter.board = req.query.board;
    if (req.query.class_id) classFilter._id = oid(req.query.class_id);

    /*
     * Every course, against every section of its class, with whoever already
     * teaches it. The SQL produced that grid by joining sections to the class
     * rather than to the course — a course belongs to a class, and each of
     * that class's sections needs its own teacher.
     */
    const classes = await Class.find({ ...classFilter, status: 'ACTIVE' })
      .select('name numeric_level board').lean();
    const classIds = classes.map((c) => c._id);

    const [courseDocs, sectionDocs] = await Promise.all([
      Course.find({ class_id: { $in: classIds }, status: 'ACTIVE' })
        .select('name code subject_id class_id')
        .populate('subject_id', 'name'),
      Section.find({ class_id: { $in: classIds }, status: 'ACTIVE' }).select('name class_id').lean(),
    ]);

    const taken = await CourseAssignment.find({
      course_id: { $in: courseDocs.map((c) => c._id) },
      status: 'ACTIVE',
    }).select('course_id section_id faculty_id')
      .populate({ path: 'faculty_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } });
    const takenBy = new Map(
      taken.map((t) => [`${t.course_id}:${t.section_id}`, t.faculty_id?.user_id?.full_name ?? null])
    );

    const pupils = new Map(
      (await Student.aggregate([
        { $match: { section_id: { $in: sectionDocs.map((x) => x._id) }, status: 'ACTIVE' } },
        { $group: { _id: '$section_id', n: { $sum: 1 } } },
      ])).map((r) => [String(r._id), r.n])
    );

    const classFor = new Map(classes.map((c) => [String(c._id), c]));
    const sectionsOf = new Map();
    for (const section of sectionDocs) {
      const key = String(section.class_id);
      if (!sectionsOf.has(key)) sectionsOf.set(key, []);
      sectionsOf.get(key).push(section);
    }

    const grid = [];
    for (const course of courseDocs) {
      const klass = classFor.get(String(course.class_id));
      for (const section of sectionsOf.get(String(course.class_id)) ?? []) {
        grid.push({
          course_id: String(course._id),
          course_name: course.name,
          course_code: course.code,
          subject_name: course.subject_id?.name ?? null,
          section_id: String(section._id),
          section_name: section.name,
          class_id: String(course.class_id),
          class_name: klass?.name ?? null,
          numeric_level: klass?.numeric_level ?? 0,
          board: klass?.board ?? null,
          students: pupils.get(String(section._id)) ?? 0,
          taken_by: takenBy.get(`${course._id}:${section._id}`) ?? null,
        });
      }
    }

    grid.sort((a, b) => String(a.board ?? '').localeCompare(String(b.board ?? ''))
      || a.numeric_level - b.numeric_level
      || String(a.section_name ?? '').localeCompare(String(b.section_name ?? ''))
      || String(a.subject_name ?? '').localeCompare(String(b.subject_name ?? '')));

    return ok(res, grid);

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
      const existing = await CourseAssignment.exists({
        course_id: oid(item.course_id),
        section_id: oid(item.section_id),
        faculty_id: oid(faculty.id),
        status: 'ACTIVE',
      });
      if (existing) continue;

      const created = await CourseAssignment.create({
        course_id: oid(item.course_id),
        section_id: oid(item.section_id),
        faculty_id: oid(faculty.id),
        academic_year_id: year._id,
        campus_id: oid(faculty.campus_id),
        is_primary: req.body.is_primary === false ? 0 : 1,
        status: 'ACTIVE',
        assigned_by: oid(req.user.id),
      });
      added.push(String(created._id));
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
    const id = req.params.assignmentId;
    const doc = await CourseAssignment.findById(oid(id))
      .populate({ path: 'faculty_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } })
      .populate('course_id', 'name');
    if (!doc) throw notFound('Assignment not found');
    const existing = {
      ...plain(doc),
      faculty_name: doc.faculty_id?.user_id?.full_name ?? null,
      course_name: doc.course_id?.name ?? null,
    };

    await CourseAssignment.deleteOne({ _id: oid(id) });
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
      const doc = await Class.findById(oid(classId))
        .select('name class_teacher_id')
        .populate({ path: 'class_teacher_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } });
      if (!doc) throw badRequest(`Unknown class (${classId})`);
      const klass = {
        id: String(doc._id),
        name: doc.name,
        class_teacher_id: doc.class_teacher_id?._id ? String(doc.class_teacher_id._id) : null,
        previous: doc.class_teacher_id?.user_id?.full_name ?? null,
      };
      if (sameId(klass.class_teacher_id, faculty.id)) continue;

      await Class.updateOne({ _id: oid(classId) }, { $set: { class_teacher_id: oid(faculty.id) } });
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
    const classId = req.params.classId;
    const classDoc = await Class.findById(oid(classId))
      .select('name class_teacher_id')
      .populate({ path: 'class_teacher_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } });
    if (!classDoc) throw notFound('Class not found');
    const klass = {
      id: String(classDoc._id),
      name: classDoc.name,
      class_teacher_id: classDoc.class_teacher_id?._id ? String(classDoc.class_teacher_id._id) : null,
      teacher: classDoc.class_teacher_id?.user_id?.full_name ?? null,
    };

    await Class.updateOne({ _id: oid(classId) }, { $set: { class_teacher_id: null } });
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
    const filter = { status: 'ACTIVE' };

    const wing = await boardOf(req.user);
    if (wing) {
      filter.board = wing;
    }

    for (const field of ['class_id', 'section_id', 'board']) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        filter[field] = field.endsWith('_id') ? oid(req.query[field]) : req.query[field];
      }
    }
    if (req.query.unassigned === 'true') filter.mentor_id = null;
    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ first_name: term }, { last_name: term }, { admission_number: term }];
    }

    return ok(
      res,
      lift(
        await Student.find(filter)
          .select('first_name last_name admission_number roll_number photo board mentor_id class_id section_id')
          .populate('class_id', 'name numeric_level')
          .populate('section_id', 'name')
          .populate({ path: 'mentor_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } })
          .limit(400),
        {
          class_id: { name: 'class_name', numeric_level: '_level' },
          section_id: { name: 'section_name' },
          'mentor_id.user_id': { full_name: 'mentor_name' },
        }
      )
        // Ordered by class, then section, then roll — the roll compared as a
        // number, so that 10 follows 9.
        .sort((a, b) => (a._level ?? 0) - (b._level ?? 0)
          || String(a.section_name ?? '').localeCompare(String(b.section_name ?? ''))
          || (Number(a.roll_number) || Infinity) - (Number(b.roll_number) || Infinity)
          || String(a.first_name ?? '').localeCompare(String(b.first_name ?? '')))
        .map(({ _level, ...row }) => ({ ...row, full_name: `${row.first_name} ${row.last_name || ''}`.trim() }))
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
      const doc = await Student.findById(oid(studentId))
        .select('first_name last_name mentor_id user_id campus_id')
        .populate({ path: 'mentor_id', select: 'user_id', populate: { path: 'user_id', select: 'full_name' } });
      if (!doc) throw badRequest(`Unknown student (${studentId})`);
      const student = {
        ...plain(doc),
        mentor_id: doc.mentor_id?._id ? String(doc.mentor_id._id) : null,
        previous: doc.mentor_id?.user_id?.full_name ?? null,
      };
      if (sameId(student.mentor_id, faculty.id)) continue;

      await Student.updateOne({ _id: oid(studentId) }, { $set: { mentor_id: oid(faculty.id) } });
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
    const studentId = req.params.studentId;
    const student = plain(await Student.findById(oid(studentId)).select('first_name last_name mentor_id'));
    if (!student) throw notFound('Student not found');
    if (!sameId(student.mentor_id, faculty.id)) throw badRequest('That student is not mentored by this member of faculty.');

    await Student.updateOne({ _id: oid(studentId) }, { $set: { mentor_id: null } });
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
      classesWithoutTeacher: await classesWithoutTeacher(req),
      studentsWithoutMentor: await Student.countDocuments({ mentor_id: null, status: 'ACTIVE' }),
      coursesWithoutTeacher: await coursesWithoutTeacher(),
    })
  )
);

export default router;
