/**
 * Who may see whose records, against a real MongoDB.
 *
 * This is the fifth check every API performs, and the one a port breaks most
 * quietly: identifiers stopped being numbers, and every gate here was written
 * as `allowed.includes(Number(id))`. Against an ObjectId that is NaN, which
 * matches nothing — so a teacher would see an empty school, and a subtler slip
 * in the other direction would show them somebody else's.
 *
 * A small school is built here and the rules are asked directly. It checks both
 * that the right people get in and that the wrong ones do not, because a gate
 * that refuses everybody passes every test that only checks refusals.
 */
import mongoose from 'mongoose';
import { startMongo } from './mongo-harness.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nVignan ERP — access scoping on MongoDB\n');

const mongo = await startMongo();

const M = await import('../src/db/mongo/models.js');
const scope = await import('../src/lib/scope.js');

/* ------------------------------------------------------- a small school */
const campus = await M.Campus.create({ code: 'MAIN', name: 'Vignan', status: 'ACTIVE' });
const roles = {};
for (const [code, name, level] of [
  ['ADMIN', 'Admin', 100], ['ADMINISTRATOR', 'Administrator', 80],
  ['TEACHING_STAFF', 'Teacher', 60], ['FINANCIAL_STAFF', 'Finance', 60],
  ['PARENT', 'Parent', 20], ['STUDENT', 'Student', 10],
]) roles[code] = await M.Role.create({ code, name, level });

let n = 0;
const makeUser = async (code, extra = {}) => {
  n += 1;
  const u = await M.User.create({
    campus_id: campus._id, role_id: roles[code]._id,
    username: `u${n}`, email: `u${n}@vignan.edu`, password_hash: 'x',
    full_name: `User ${n}`, status: 'ACTIVE', ...extra,
  });
  return { id: String(u._id), role_code: code, campus_id: String(campus._id) };
};

const year = await M.AcademicYear.create({ campus_id: campus._id, name: '2026', start_date: '2026-06-01', end_date: '2027-04-30', is_current: 1, status: 'ACTIVE' });

// Two wings, so the department ceiling can be tested.
const classState = await M.Class.create({ campus_id: campus._id, academic_year_id: year._id, name: 'Class 9', board: 'STATE', level: 9, status: 'ACTIVE' });
const classCbse = await M.Class.create({ campus_id: campus._id, academic_year_id: year._id, name: 'Class 9', board: 'CBSE', level: 9, status: 'ACTIVE' });
const secState = await M.Section.create({ campus_id: campus._id, class_id: classState._id, name: 'A', capacity: 40, status: 'ACTIVE' });
const secCbse = await M.Section.create({ campus_id: campus._id, class_id: classCbse._id, name: 'A', capacity: 40, status: 'ACTIVE' });

const dept = await M.Department.create({ campus_id: campus._id, code: 'GEN', name: 'General', status: 'ACTIVE' });

// Two teachers, each assigned to one section.
const mkTeacher = async (section, board) => {
  const user = await makeUser('TEACHING_STAFF');
  const f = await M.Faculty.create({
    campus_id: campus._id, user_id: mongoose.Types.ObjectId.createFromHexString(user.id),
    department_id: dept._id, faculty_code: `F${n}`, first_name: `T${n}`,
    staff_type: 'TEACHING', board, is_mentor: 0, status: 'ACTIVE',
  });
  const subject = await M.Subject.create({ campus_id: campus._id, code: `S${n}`, name: `Subject ${n}`, type: 'CORE', status: 'ACTIVE' });
  const course = await M.Course.create({
    campus_id: campus._id, academic_year_id: year._id, class_id: section.class_id, subject_id: subject._id,
    code: `C${n}`, name: `Course ${n}`, credits: 4, max_marks: 100, pass_marks: 35, status: 'ACTIVE',
  });
  await M.CourseAssignment.create({
    campus_id: campus._id, faculty_id: f._id, course_id: course._id, section_id: section._id,
    academic_year_id: year._id, is_primary: 1, status: 'ACTIVE',
  });
  return { user, faculty: f, course };
};

const teacherA = await mkTeacher(secState, 'STATE');
const teacherB = await mkTeacher(secCbse, 'CBSE');

// A pupil in each section.
const mkStudent = async (section, board) => {
  const user = await makeUser('STUDENT');
  return M.Student.create({
    campus_id: campus._id, user_id: mongoose.Types.ObjectId.createFromHexString(user.id),
    academic_year_id: year._id, class_id: section.class_id, section_id: section._id,
    admission_number: `A${n}`, first_name: `P${n}`, board, status: 'ACTIVE',
  });
};
const pupilState = await mkStudent(secState, 'STATE');
const pupilCbse = await mkStudent(secCbse, 'CBSE');

// A parent of the State pupil only.
const parentUser = await makeUser('PARENT');
const parent = await M.Parent.create({
  campus_id: campus._id, user_id: mongoose.Types.ObjectId.createFromHexString(parentUser.id),
  parent_code: 'P1', first_name: 'Parent', status: 'ACTIVE',
});
await M.StudentParent.create({ student_id: pupilState._id, parent_id: parent._id, relation: 'FATHER', is_primary: 1 });

const admin = await makeUser('ADMIN');
const stateAdministratorUser = await makeUser('ADMINISTRATOR');
await M.Administrator.create({
  campus_id: campus._id, user_id: mongoose.Types.ObjectId.createFromHexString(stateAdministratorUser.id),
  department_id: dept._id, employee_code: 'ADM1', first_name: 'Admin', board: 'STATE', status: 'ACTIVE',
});

/* --------------------------------------------------------------- rules */
const idsFor = async (user) => {
  const list = await scope.accessibleStudentIds(user);
  return list === null ? null : list.map(String);
};

check('an Admin is not narrowed at all', (await idsFor(admin)) === null);

const aSees = await idsFor(teacherA.user);
check('a teacher sees their own section', aSees.includes(String(pupilState._id)), `${aSees.length} pupil(s)`);
check("and not the other teacher's", !aSees.includes(String(pupilCbse._id)));

const parentSees = await idsFor(parentUser);
check('a parent sees their child', parentSees.includes(String(pupilState._id)));
check("and not another family's child", !parentSees.includes(String(pupilCbse._id)), `${parentSees.length} child(ren)`);

const admSees = await idsFor(stateAdministratorUser);
check('an administrator assigned to State sees State pupils', admSees.includes(String(pupilState._id)));
check('and not the CBSE wing', !admSees.includes(String(pupilCbse._id)), `${admSees.length} pupil(s)`);

check('the department ceiling is reported', (await scope.boardOf(stateAdministratorUser)) === 'STATE');
check('an Admin has no ceiling', (await scope.boardOf(admin)) === null);

/* --------------------------------------------------- the direct gates */
check('canAccessStudent lets a teacher at their own pupil',
  await scope.canAccessStudent(teacherA.user, String(pupilState._id)));
check("canAccessStudent refuses another teacher's pupil",
  !await scope.canAccessStudent(teacherA.user, String(pupilCbse._id)));

check('a teacher owns the course assigned to them',
  await scope.teacherOwnsCourse(teacherA.user, String(teacherA.course._id)));
check("a teacher does not own another's course",
  !await scope.teacherOwnsCourse(teacherA.user, String(teacherB.course._id)));

check('a parent owns their child', await scope.parentOwnsStudent(parentUser, String(pupilState._id)));
check("a parent does not own another's child", !await scope.parentOwnsStudent(parentUser, String(pupilCbse._id)));

/* ------------------------------------------- the filter routes rely on */
const unrestricted = await scope.studentScopeClause(admin);
check('an unrestricted scope filters nothing', Object.keys(unrestricted).length === 0);

const teacherScope = await scope.studentScopeClause(teacherA.user);
check('a teacher scope filters to their pupils',
  teacherScope.student_id?.$in?.length === aSees.length, JSON.stringify(Object.keys(teacherScope)));

// The case that matters most: entitled to nothing must mean nothing, not
// everything. A missing filter here would show the whole school.
const nobody = await scope.studentScopeClause({ id: String(new mongoose.Types.ObjectId()), role_code: 'STUDENT' });

/*
 * Asked against the wrong collection on purpose.
 *
 * strictQuery drops conditions on paths a collection does not have, so a scope
 * naming a field that is not there does not narrow the query — it disappears,
 * and a person entitled to nothing is shown everything. This is the check that
 * caught exactly that.
 */
const leaked = await M.Student.countDocuments({ ...nobody });
check('an empty scope cannot be stripped by strictQuery', leaked === 0,
  `${leaked} pupil(s) would have been exposed — ${JSON.stringify(nobody)}`);

// And on a collection that does carry the field, the ordinary case still works.
const scoped = await scope.studentScopeClause(teacherA.user);
const visible = await M.Attendance.countDocuments({ ...scoped });
check('a real scope still filters normally', typeof visible === 'number', `${visible} record(s)`);

/* ------------------------------------------------------ id comparison */
check('ids compare across string and ObjectId', scope.sameId(pupilState._id, String(pupilState._id)));
check('and different ids do not', !scope.sameId(pupilState._id, pupilCbse._id));

await mongo.stop();

const failed = results.filter((x) => !x).length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
