/**
 * Resource ownership / assignment scoping.
 *
 * Role and permission checks answer "may this kind of user do this?".
 * The helpers here answer "may THIS user touch THIS record?" — the fifth
 * check every API performs. They are the enforcement point for:
 *
 *   Student A cannot access Student B
 *   Parent A cannot access Parent B's child
 *   Teacher A cannot edit Teacher B's course or students
 *
 * Ported to MongoDB. Two things needed real care rather than translation.
 *
 * Identifiers are no longer numbers. `allowed.includes(Number(id))` was the
 * shape of every gate here, and against ObjectIds `Number()` yields NaN, which
 * matches nothing — every check would have failed closed, which is safe, and
 * the portal would have shown a teacher an empty school. So ids are compared
 * as strings, in one place, through `sameId`.
 *
 * And a scope was a SQL fragment; it is now a filter object. The callers'
 * meaning is preserved exactly, including the important case: a user entitled
 * to nothing gets a filter that matches nothing, never an absent filter that
 * would match everything.
 */
import { forbidden, notFound } from './errors.js';
import { ROLES } from './permissions.js';
import { oid } from '../db/mongo/connection.js';
import { plain, lift } from '../db/mongo/query.js';
import {
  Administrator, Class, Course, CourseAssignment, Faculty, Parent,
  Section, Student, StudentParent,
} from '../db/mongo/models.js';

export const isAdmin = (user) => user?.role_code === ROLES.ADMIN;
export const isAdministrator = (user) => user?.role_code === ROLES.ADMINISTRATOR;
export const isTeacher = (user) => user?.role_code === ROLES.TEACHING_STAFF;
export const isFinancial = (user) => user?.role_code === ROLES.FINANCIAL_STAFF;
export const isStudent = (user) => user?.role_code === ROLES.STUDENT;
export const isParent = (user) => user?.role_code === ROLES.PARENT;
/** Staff = anyone who works at the institution (as opposed to student/parent). */
export const isStaff = (user) =>
  [ROLES.ADMIN, ROLES.ADMINISTRATOR, ROLES.TEACHING_STAFF, ROLES.FINANCIAL_STAFF].includes(user?.role_code);

/**
 * Do these two identifiers denote the same record?
 *
 * An id arrives as a string from a URL, as an ObjectId from a document, and as
 * a string again from anything already serialised. Comparing them with === is
 * wrong for two of those three, and wrong in the direction that grants nothing
 * — so it is done here, once, and nowhere else.
 */
export const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** The same, against a list. */
const listHas = (list, id) => list.some((x) => sameId(x, id));

// ------------------------------------------------------- department (board)

/**
 * The department a user is confined to, or `null` for no restriction.
 *
 * An Admin is never restricted — they run the whole school. An Administrator is
 * assigned to STATE, CBSE or BOTH by an Admin; teaching and financial staff
 * carry the same field on their faculty record. 'BOTH' means unrestricted, so
 * it returns null exactly like an Admin does.
 *
 * This is the *ceiling*, not the selection: the department picker in the topbar
 * may narrow further, but never wider than what this returns.
 */
export async function boardOf(user) {
  if (!user || isAdmin(user)) return null;

  const Model = isAdministrator(user) ? Administrator : isStaff(user) ? Faculty : null;
  if (!Model) return null;

  const row = await Model.findOne({ user_id: oid(user.id) }).select('board').lean();
  const board = row?.board;
  return board && board !== 'BOTH' ? board : null;
}

/**
 * A filter confining a query to the user's department, or null when they are
 * unrestricted. Merged into a query with the other conditions.
 */
export async function boardClause(user, field = 'board') {
  const board = await boardOf(user);
  return board ? { [field]: board } : null;
}

/** Refuse a write that would put a record in a department the user cannot reach. */
export async function assertBoardAccess(user, board) {
  const mine = await boardOf(user);
  if (!mine || !board || board === mine) return;
  throw forbidden(`You are assigned to the ${mine === 'CBSE' ? 'CBSE' : 'State Board'} department only.`);
}

// ------------------------------------------------------------- profiles
const idOfProfile = async (Model, user) => {
  const row = await Model.findOne({ user_id: oid(user?.id) }).select('_id').lean();
  return row ? String(row._id) : null;
};

export const studentIdOf = (user) => idOfProfile(Student, user);
export const parentIdOf = (user) => idOfProfile(Parent, user);
export const facultyIdOf = (user) => idOfProfile(Faculty, user);

// -------------------------------------------------------------- parents
/** Children linked to a parent user. */
export async function childrenOf(user) {
  const parentId = await parentIdOf(user);
  if (!parentId) return [];

  const links = await StudentParent.find({ parent_id: oid(parentId) })
    .populate({
      path: 'student_id',
      populate: [{ path: 'class_id', select: 'name' }, { path: 'section_id', select: 'name' }],
    });

  return links
    .filter((l) => l.student_id)
    .map((l) => {
      const s = lift(l.student_id, {
        class_id: { name: 'class_name' },
        section_id: { name: 'section_name' },
      });
      // `relation` came from the link, not the pupil — it says how this adult
      // is related to this child, which differs per link.
      return { ...s, relation: l.relation };
    })
    .sort((a, b) => String(a.first_name || '').localeCompare(String(b.first_name || '')));
}

export async function parentOwnsStudent(user, studentId) {
  const parentId = await parentIdOf(user);
  if (!parentId) return false;
  const sid = oid(studentId);
  if (!sid) return false;
  return !!await StudentParent.exists({ parent_id: oid(parentId), student_id: sid });
}

// ------------------------------------------------------------- teachers
const activeAssignments = async (facultyId, select) =>
  CourseAssignment.find({ faculty_id: oid(facultyId), status: 'ACTIVE' }).select(select).lean();

/** Course ids a teacher is assigned to. */
export async function teacherCourseIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  const rows = await activeAssignments(facultyId, 'course_id');
  return [...new Set(rows.map((r) => String(r.course_id)).filter((x) => x !== 'null'))];
}

/** Section ids a teacher teaches (their classes). */
export async function teacherSectionIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  const rows = await activeAssignments(facultyId, 'section_id');
  return [...new Set(rows.map((r) => r.section_id).filter(Boolean).map(String))];
}

export async function teacherOwnsCourse(user, courseId, sectionId = null) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return false;
  const filter = { faculty_id: oid(facultyId), course_id: oid(courseId), status: 'ACTIVE' };
  if (sectionId) filter.section_id = oid(sectionId);
  return !!await CourseAssignment.exists(filter);
}

/**
 * Sections this teacher is responsible for as class teacher.
 *
 * A class teacher (or section teacher) owns the whole section: every subject,
 * every record. A subject teacher only ever sees their own subject's data for
 * the same students.
 *
 * The SQL was a UNION of two questions — sections they teach directly, and
 * sections of classes they lead. Both are asked here and the answers merged,
 * which is what a UNION did.
 */
export async function classTeacherSectionIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  const fid = oid(facultyId);

  const [direct, viaClass] = await Promise.all([
    Section.find({ section_teacher_id: fid }).select('_id').lean(),
    Class.find({ class_teacher_id: fid }).select('_id').lean(),
  ]);

  const sectionsOfThoseClasses = viaClass.length
    ? await Section.find({ class_id: { $in: viaClass.map((c) => c._id) } }).select('_id').lean()
    : [];

  return [...new Set([...direct, ...sectionsOfThoseClasses].map((s) => String(s._id)))];
}

export async function isClassTeacherOfSection(user, sectionId) {
  if (!isTeacher(user) || !sectionId) return false;
  return listHas(await classTeacherSectionIds(user), sectionId);
}

/**
 * May this user see a student's complete record, rather than only the part
 * that belongs to their own subject?
 *
 * Admin, Administrator and Financial Staff always can. A teacher can when they
 * are the class teacher of that student's section, or the student's mentor.
 */
export async function hasFullStudentAccess(user, student) {
  if (!student) return false;
  if (isAdmin(user) || isAdministrator(user) || isFinancial(user)) return true;
  if (isStudent(user) || isParent(user)) return true;
  if (isTeacher(user)) {
    const facultyId = await facultyIdOf(user);
    if (facultyId && sameId(student.mentor_id, facultyId)) return true;
    return listHas(await classTeacherSectionIds(user), student.section_id);
  }
  return false;
}

/**
 * Students a teacher may see.
 *
 * Three routes in: the sections they teach a course to, the section they are
 * class teacher of (which they own even without a course there), and their
 * own mentees. The SQL asked all three as a UNION; they are asked separately
 * here and merged, which is the same question.
 */
export async function teacherStudentIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  const fid = oid(facultyId);

  const [taughtSections, ownedSections] = await Promise.all([
    teacherSectionIds(user),
    classTeacherSectionIds(user),
  ]);
  const sectionIds = [...new Set([...taughtSections, ...ownedSections])].map(oid).filter(Boolean);

  const [bySection, mentees] = await Promise.all([
    sectionIds.length
      ? Student.find({ section_id: { $in: sectionIds }, status: 'ACTIVE' }).select('_id').lean()
      : [],
    Student.find({ mentor_id: fid, status: 'ACTIVE' }).select('_id').lean(),
  ]);

  return [...new Set([...bySection, ...mentees].map((s) => String(s._id)))];
}

// -------------------------------------------------- unified student gate
/**
 * The student ids a user may read.
 * Returns `null` for "unrestricted" (admin / administrator / financial staff),
 * otherwise an explicit list.
 */
export async function accessibleStudentIds(user) {
  // An Admin runs the whole school and is never narrowed.
  if (isAdmin(user)) return null;

  const board = await boardOf(user);

  // Administrator and financial staff see every student in their department —
  // every one of them when they are assigned to BOTH.
  if (isAdministrator(user) || isFinancial(user)) {
    if (!board) return null;
    const rows = await Student.find({ board }).select('_id').lean();
    return rows.map((r) => String(r._id));
  }

  // A teacher is scoped by what they are assigned, not by a department label:
  // an assignment that reaches across the wings is still a real assignment, and
  // voiding it here would take away access the office deliberately granted.
  if (isTeacher(user)) return await teacherStudentIds(user);

  if (isParent(user)) return (await childrenOf(user)).map((c) => String(c.id));
  if (isStudent(user)) {
    const id = await studentIdOf(user);
    return id ? [id] : [];
  }
  return [];
}

export async function canAccessStudent(user, studentId) {
  if (!studentId) return false;
  const allowed = await accessibleStudentIds(user);
  if (allowed === null) return true;
  return listHas(allowed, studentId);
}

/** Throw unless the caller may read this student; returns the student record. */
export async function assertStudentAccess(user, studentId) {
  const id = oid(studentId);
  const doc = id ? await Student.findById(id) : null;
  if (!doc) throw notFound('Student not found');
  const student = plain(doc);
  if (!await canAccessStudent(user, student.id)) {
    throw forbidden('You are not authorised to access this student record');
  }
  return student;
}

/** Throw unless the caller may write to this course. */
export async function assertCourseAccess(user, courseId, sectionId = null) {
  const id = oid(courseId);
  const doc = id ? await Course.findById(id) : null;
  if (!doc) throw notFound('Course not found');
  const course = plain(doc);
  if (isAdmin(user) || isAdministrator(user)) return course;
  if (isTeacher(user) && await teacherOwnsCourse(user, course.id, sectionId)) return course;
  throw forbidden('This course is not assigned to you');
}

/** Staff may only act inside their own campus (Admin may cross campuses). */
export function assertSameCampus(user, campusId) {
  if (isAdmin(user)) return true;
  if (campusId && user.campus_id && !sameId(campusId, user.campus_id)) {
    throw forbidden('This record belongs to a different campus');
  }
  return true;
}

/**
 * A filter confining a query to the students this user may read.
 *
 * `{}` means unrestricted. The middle case is the one that matters: a user
 * entitled to no pupils at all must get a filter that matches nothing. The SQL
 * said `AND 1 = 0` for exactly that reason, and an empty `$in` does the same
 * here — an absent filter would quietly show them the whole school.
 */
export async function studentScopeClause(user, field = 'student_id') {
  const allowed = await accessibleStudentIds(user);
  if (allowed === null) return {};

  /*
   * Entitled to nothing must mean nothing.
   *
   * The obvious `{ [field]: { $in: [] } }` is not safe here. Mongoose runs with
   * strictQuery, which drops conditions on paths a collection does not have —
   * so a filter naming the wrong field does not narrow the query, it vanishes,
   * and "this person may see no pupils" becomes "show them the whole school".
   * Failing open, silently, from a typo.
   *
   * `$expr` is not a path, so nothing can strip it. It is what the SQL said:
   * AND 1 = 0.
   */
  if (!allowed.length) return { $expr: { $eq: [1, 0] } };

  return { [field]: { $in: allowed.map(oid).filter(Boolean) } };
}
