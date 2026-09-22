/**
 * Who a notice reaches.
 *
 * Two of these audiences were SQL UNIONs — a class means its pupils *and*
 * their parents — and a union is the easiest thing to lose in a port: drop
 * half and the announcement still "works", it just never reaches the families.
 * Nobody reports a message they were never told about.
 *
 * So each audience is asked for, and checked both for who it includes and who
 * it leaves out.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nVignan ERP — notification audiences on MongoDB\n');

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'vignan' });

const M = await import('../src/db/mongo/models.js');
const { resolveAudience, notify, notifyMany } = await import('../src/lib/notify.js');

const oidOf = (s) => mongoose.Types.ObjectId.createFromHexString(String(s));

const campus = await M.Campus.create({ code: 'MAIN', name: 'Vignan', status: 'ACTIVE' });
const other = await M.Campus.create({ code: 'OTHER', name: 'Elsewhere', status: 'ACTIVE' });
const role = await M.Role.create({ code: 'STUDENT', name: 'Student', level: 10 });
const year = await M.AcademicYear.create({ campus_id: campus._id, name: '2026', start_date: '2026-06-01', end_date: '2027-04-30', is_current: 1, status: 'ACTIVE' });
const klass = await M.Class.create({ campus_id: campus._id, academic_year_id: year._id, name: 'Class 9', board: 'STATE', level: 9, status: 'ACTIVE' });
const sectionA = await M.Section.create({ campus_id: campus._id, class_id: klass._id, name: 'A', capacity: 40, status: 'ACTIVE' });
const sectionB = await M.Section.create({ campus_id: campus._id, class_id: klass._id, name: 'B', capacity: 40, status: 'ACTIVE' });
const dept = await M.Department.create({ campus_id: campus._id, code: 'GEN', name: 'General', status: 'ACTIVE' });

let n = 0;
const user = async (campusId = campus._id, status = 'ACTIVE') => {
  n += 1;
  return M.User.create({
    campus_id: campusId, role_id: role._id, username: `u${n}`, email: `u${n}@v.edu`,
    password_hash: 'x', full_name: `U${n}`, status,
  });
};

const pupil = async (section) => {
  const u = await user();
  const s = await M.Student.create({
    campus_id: campus._id, user_id: u._id, academic_year_id: year._id,
    class_id: klass._id, section_id: section._id, admission_number: `A${n}`,
    first_name: `P${n}`, board: 'STATE', status: 'ACTIVE',
  });
  return { user: u, student: s };
};

const pupilA = await pupil(sectionA);
const pupilB = await pupil(sectionB);

// One parent, with a child in section A only.
const parentUser = await user();
const parent = await M.Parent.create({ campus_id: campus._id, user_id: parentUser._id, parent_code: 'P1', first_name: 'Parent', status: 'ACTIVE' });
await M.StudentParent.create({ student_id: pupilA.student._id, parent_id: parent._id, relation: 'FATHER', is_primary: 1 });

// A teacher, a bursar, and somebody at another campus entirely.
const teacherUser = await user();
await M.Faculty.create({ campus_id: campus._id, user_id: teacherUser._id, department_id: dept._id, faculty_code: 'F1', first_name: 'T', staff_type: 'TEACHING', board: 'STATE', is_mentor: 0, status: 'ACTIVE' });
const bursarUser = await user();
await M.Faculty.create({ campus_id: campus._id, user_id: bursarUser._id, department_id: dept._id, faculty_code: 'F2', first_name: 'B', staff_type: 'FINANCIAL', board: 'BOTH', is_mentor: 0, status: 'ACTIVE' });
const elsewhere = await user(other._id);
const resigned = await user(campus._id, 'INACTIVE');
await M.Faculty.create({ campus_id: campus._id, user_id: resigned._id, department_id: dept._id, faculty_code: 'F3', first_name: 'R', staff_type: 'TEACHING', board: 'STATE', is_mentor: 0, status: 'INACTIVE' });

const audience = (opts) => resolveAudience({ campusId: String(campus._id), ...opts });
const has = (list, u) => list.map(String).includes(String(u._id));

/* ------------------------------------------------------- simple audiences */
const students = await audience({ targetType: 'STUDENTS' });
check('pupils are reached', has(students, pupilA.user) && has(students, pupilB.user), `${students.length}`);
check('and nobody else is', !has(students, teacherUser) && !has(students, parentUser));

const teaching = await audience({ targetType: 'TEACHING_STAFF' });
check('teaching staff are reached', has(teaching, teacherUser));
check('and the bursar is not', !has(teaching, bursarUser), `${teaching.length} teacher(s)`);

const financial = await audience({ targetType: 'FINANCIAL_STAFF' });
check('financial staff are reached separately', has(financial, bursarUser) && !has(financial, teacherUser));

/* -------------------------------------------------------------- the unions */
const classAudience = await audience({ targetType: 'CLASS', classId: String(klass._id) });
check('a class reaches its pupils', has(classAudience, pupilA.user) && has(classAudience, pupilB.user));
check('a class also reaches their parents — the UNION', has(classAudience, parentUser),
  'lose this half and families are never told');

const sectionAudience = await audience({ targetType: 'SECTION', sectionId: String(sectionA._id) });
check('a section reaches only its own pupils',
  has(sectionAudience, pupilA.user) && !has(sectionAudience, pupilB.user));
check("and that section's parents", has(sectionAudience, parentUser));

/* ------------------------------------------------------------- exclusions */
const all = await audience({ targetType: 'ALL' });
check('everyone at this campus is reached', has(all, pupilA.user) && has(all, teacherUser));
check('another campus is not', !has(all, elsewhere), 'a notice must not cross campuses');
check('someone who has left is not', !has(all, resigned));

/* ------------------------------------------------------ no double delivery */
const dupes = classAudience.filter((x, i) => classAudience.indexOf(x) !== i);
check('nobody is told twice', dupes.length === 0, `${dupes.length} duplicate(s)`);

/* ------------------------------------------------------------ the writing */
const id = await notify({ userId: String(pupilA.user._id), campusId: String(campus._id), type: 'TEST', title: 'Hello', entityType: 'Student', entityId: String(pupilA.student._id) });
check('a notification is written', typeof id === 'string' && id.length === 24, id);

const saved = await M.Notification.findById(oidOf(id)).lean();
check('it points at the right person', String(saved.user_id) === String(pupilA.user._id));
check('and records what it was about', saved.entity_id === String(pupilA.student._id),
  'an id from any collection, so stored as text');

const sent = await notifyMany([String(pupilA.user._id), String(pupilB.user._id), String(pupilA.user._id)], { type: 'T', title: 'Many' });
check('notifyMany does not write the same person twice', sent === 2, `${sent} written`);

await mongoose.disconnect();
await mongod.stop();

const failed = results.filter((x) => !x).length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
