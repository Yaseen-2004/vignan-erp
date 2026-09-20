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
 */
import { get, all } from '../db/connection.js';
import { forbidden, notFound } from './errors.js';
import { ROLES } from './permissions.js';

export const isAdmin = (user) => user?.role_code === ROLES.ADMIN;
export const isAdministrator = (user) => user?.role_code === ROLES.ADMINISTRATOR;
export const isTeacher = (user) => user?.role_code === ROLES.TEACHING_STAFF;
export const isFinancial = (user) => user?.role_code === ROLES.FINANCIAL_STAFF;
export const isStudent = (user) => user?.role_code === ROLES.STUDENT;
export const isParent = (user) => user?.role_code === ROLES.PARENT;
/** Staff = anyone who works at the institution (as opposed to student/parent). */
export const isStaff = (user) =>
  [ROLES.ADMIN, ROLES.ADMINISTRATOR, ROLES.TEACHING_STAFF, ROLES.FINANCIAL_STAFF].includes(user?.role_code);

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

  const table = isAdministrator(user) ? 'administrators' : isStaff(user) ? 'faculty' : null;
  if (!table) return null;

  const row = await get(`SELECT board FROM ${table} WHERE user_id = ?`, [user.id]);
  const board = row?.board;
  return board && board !== 'BOTH' ? board : null;
}

/**
 * A WHERE fragment confining a query to the user's department, or null when
 * they are unrestricted. `column` must already be qualified for the query.
 */
export async function boardClause(user, column = 'board') {
  const board = await boardOf(user);
  return board ? { clause: `${column} = ?`, params: [board] } : null;
}

/** Refuse a write that would put a record in a department the user cannot reach. */
export async function assertBoardAccess(user, board) {
  const mine = await boardOf(user);
  if (!mine || !board || board === mine) return;
  throw forbidden(`You are assigned to the ${mine === 'CBSE' ? 'CBSE' : 'State Board'} department only.`);
}

// ------------------------------------------------------------- profiles
export async function studentIdOf(user) {
  const row = await get('SELECT id FROM students WHERE user_id = ?', [user.id]);
  return row?.id ?? null;
}

export async function parentIdOf(user) {
  const row = await get('SELECT id FROM parents WHERE user_id = ?', [user.id]);
  return row?.id ?? null;
}

export async function facultyIdOf(user) {
  const row = await get('SELECT id FROM faculty WHERE user_id = ?', [user.id]);
  return row?.id ?? null;
}

// -------------------------------------------------------------- parents
/** Children linked to a parent user. */
export async function childrenOf(user) {
  const parentId = await parentIdOf(user);
  if (!parentId) return [];
  return await all(
    `SELECT s.id, s.admission_number, s.roll_number, s.first_name, s.last_name, s.photo,
            s.class_id, s.section_id, s.status, s.campus_id,
            c.name AS class_name, sec.name AS section_name, sp.relation
       FROM student_parents sp
       JOIN students s ON s.id = sp.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE sp.parent_id = ?
      ORDER BY s.first_name`,
    [parentId]
  );
}

export async function parentOwnsStudent(user, studentId) {
  const parentId = await parentIdOf(user);
  if (!parentId) return false;
  return !!await get('SELECT 1 AS ok FROM student_parents WHERE parent_id = ? AND student_id = ?', [parentId, studentId]);
}

// ------------------------------------------------------------- teachers
/** Course ids a teacher is assigned to. */
export async function teacherCourseIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  return (await all(
    `SELECT DISTINCT course_id FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE'`,
    [facultyId]
  )).map((r) => r.course_id);
}

/** Section ids a teacher teaches (their classes). */
export async function teacherSectionIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  return (await all(
    `SELECT DISTINCT section_id FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE'`,
    [facultyId]
  )).map((r) => r.section_id);
}

export async function teacherOwnsCourse(user, courseId, sectionId = null) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return false;
  const params = [facultyId, courseId];
  let sql = `SELECT 1 AS ok FROM course_assignments WHERE faculty_id = ? AND course_id = ? AND status = 'ACTIVE'`;
  if (sectionId) {
    sql += ' AND section_id = ?';
    params.push(sectionId);
  }
  return !!await get(sql, params);
}

/**
 * Sections this teacher is responsible for as class teacher.
 *
 * A class teacher (or section teacher) owns the whole section: every subject,
 * every record. A subject teacher only ever sees their own subject's data for
 * the same students.
 */
export async function classTeacherSectionIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  return (await all(
    `SELECT s.id FROM sections s WHERE s.section_teacher_id = ?
      UNION
     SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id WHERE c.class_teacher_id = ?`,
    [facultyId, facultyId]
  )).map((r) => r.id);
}

export async function isClassTeacherOfSection(user, sectionId) {
  if (!isTeacher(user) || !sectionId) return false;
  return (await classTeacherSectionIds(user)).includes(Number(sectionId));
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
    if (facultyId && student.mentor_id === facultyId) return true;
    return (await classTeacherSectionIds(user)).includes(student.section_id);
  }
  return false;
}

/**
 * Students a teacher may see.
 *
 * Three routes in: the sections they teach a course to, the section they are
 * class teacher of (which they own even without a course there), and their
 * own mentees.
 */
export async function teacherStudentIds(user) {
  const facultyId = await facultyIdOf(user);
  if (!facultyId) return [];
  return (await all(
    `SELECT DISTINCT s.id
       FROM students s
       JOIN course_assignments ca ON ca.section_id = s.section_id
      WHERE ca.faculty_id = ? AND ca.status = 'ACTIVE' AND s.status = 'ACTIVE'
      UNION
     SELECT s.id FROM students s
       JOIN sections sec ON sec.id = s.section_id
       JOIN classes c ON c.id = sec.class_id
      WHERE (sec.section_teacher_id = ? OR c.class_teacher_id = ?) AND s.status = 'ACTIVE'
      UNION
     SELECT id FROM students WHERE mentor_id = ? AND status = 'ACTIVE'`,
    [facultyId, facultyId, facultyId, facultyId]
  )).map((r) => r.id);
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
    return (await all("SELECT id FROM students WHERE board = ?", [board])).map((row) => row.id);
  }

  // A teacher is scoped by what they are assigned, not by a department label:
  // an assignment that reaches across the wings is still a real assignment, and
  // voiding it here would take away access the office deliberately granted.
  if (isTeacher(user)) return await teacherStudentIds(user);

  if (isParent(user)) return (await childrenOf(user)).map((c) => c.id);
  if (isStudent(user)) {
    const id = await studentIdOf(user);
    return id ? [id] : [];
  }
  return [];
}

export async function canAccessStudent(user, studentId) {
  const id = Number(studentId);
  if (!id) return false;
  const allowed = await accessibleStudentIds(user);
  if (allowed === null) return true;
  return allowed.includes(id);
}

/** Throw unless the caller may read this student; returns the student row. */
export async function assertStudentAccess(user, studentId) {
  const student = await get('SELECT * FROM students WHERE id = ?', [Number(studentId)]);
  if (!student) throw notFound('Student not found');
  if (!await canAccessStudent(user, student.id)) {
    throw forbidden('You are not authorised to access this student record');
  }
  return student;
}

/** Throw unless the caller may write to this course. */
export async function assertCourseAccess(user, courseId, sectionId = null) {
  const course = await get('SELECT * FROM courses WHERE id = ?', [Number(courseId)]);
  if (!course) throw notFound('Course not found');
  if (isAdmin(user) || isAdministrator(user)) return course;
  if (isTeacher(user) && await teacherOwnsCourse(user, course.id, sectionId)) return course;
  throw forbidden('This course is not assigned to you');
}

/** Staff may only act inside their own campus (Admin may cross campuses). */
export function assertSameCampus(user, campusId) {
  if (isAdmin(user)) return true;
  if (campusId && user.campus_id && Number(campusId) !== Number(user.campus_id)) {
    throw forbidden('This record belongs to a different campus');
  }
  return true;
}

/**
 * Build a `WHERE ... IN (...)` fragment for a student-scoped query.
 * Returns { clause, params } where clause is '' when unrestricted.
 */
export async function studentScopeClause(user, column = 'student_id') {
  const allowed = await accessibleStudentIds(user);
  if (allowed === null) return { clause: '', params: [] };
  if (!allowed.length) return { clause: ` AND 1 = 0`, params: [] };
  return { clause: ` AND ${column} IN (${allowed.map(() => '?').join(',')})`, params: allowed };
}
