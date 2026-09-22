/**
 * A mapping that crosses two references.
 *
 * `JOIN faculty f ON f.id = mr.mentor_id JOIN users u ON u.id = f.user_id ...
 * u.full_name AS mentor_name` is two hops: the record points at a faculty
 * member, who points at a user, and the name wanted is the user's. Written as
 * 'mentor_id.user_id', it has to fetch both and lift the name onto the record
 * as the chain of joins did.
 */
import mongoose from 'mongoose';
import { startMongo } from './mongo-harness.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nVignan ERP — mappings across references\n');

const mongo = await startMongo();
const M = await import('../src/db/mongo/models.js');
const { lift, populateFor } = await import('../src/db/mongo/query.js');

const campus = await M.Campus.create({ code: 'MAIN', name: 'Vignan', status: 'ACTIVE' });
const role = await M.Role.create({ code: 'TEACHING_STAFF', name: 'Teacher', level: 60 });
const dept = await M.Department.create({ campus_id: campus._id, code: 'GEN', name: 'General', status: 'ACTIVE' });
const year = await M.AcademicYear.create({ campus_id: campus._id, name: '2026', start_date: '2026-06-01', end_date: '2027-04-30', is_current: 1, status: 'ACTIVE' });
const klass = await M.Class.create({ campus_id: campus._id, academic_year_id: year._id, name: 'Class 9', board: 'STATE', level: 9, status: 'ACTIVE' });
const section = await M.Section.create({ campus_id: campus._id, class_id: klass._id, name: 'A', capacity: 40, status: 'ACTIVE' });

const mentorUser = await M.User.create({
  campus_id: campus._id, role_id: role._id, username: 'basavaraj', email: 'b@v.edu',
  password_hash: 'x', full_name: 'Basavaraj Hiremath', status: 'ACTIVE',
});
const mentor = await M.Faculty.create({
  campus_id: campus._id, user_id: mentorUser._id, department_id: dept._id,
  faculty_code: 'FAC001', first_name: 'Basavaraj', staff_type: 'TEACHING',
  board: 'STATE', is_mentor: 1, status: 'ACTIVE',
});
const pupilUser = await M.User.create({
  campus_id: campus._id, role_id: role._id, username: 'pupil1', email: 'p@v.edu',
  password_hash: 'x', full_name: 'Sangamesh Kulkarni', status: 'ACTIVE',
});
const pupil = await M.Student.create({
  campus_id: campus._id, user_id: pupilUser._id, academic_year_id: year._id,
  class_id: klass._id, section_id: section._id, admission_number: 'VGN001',
  first_name: 'Sangamesh', last_name: 'Kulkarni', board: 'STATE', status: 'ACTIVE',
  mentor_id: mentor._id,
});
const record = await M.MentoringRecord.create({
  campus_id: campus._id, student_id: pupil._id, mentor_id: mentor._id,
  meeting_date: '2026-09-01', record_type: 'MEETING', title: 'Term review',
});

/* The mapping the SQL select implied. */
const mapping = {
  student_id: { first_name: 'first_name', last_name: 'last_name', admission_number: 'admission_number' },
  mentor_id: { faculty_code: 'faculty_code' },
  'mentor_id.user_id': { full_name: 'mentor_name' },
  'student_id.class_id': { name: 'class_name' },
  'student_id.section_id': { name: 'section_name' },
};

const spec = populateFor(mapping);
check('paths sharing a first step are fetched once',
  spec.filter((s) => s.path === 'mentor_id').length === 1 && spec.filter((s) => s.path === 'student_id').length === 1,
  spec.map((s) => s.path).join(', '));

const doc = await M.MentoringRecord.findById(record._id).populate(spec);
const row = lift(doc, mapping);

check('a one-hop field is lifted', row.first_name === 'Sangamesh', row.first_name);
check('a two-hop field is lifted — faculty then user',
  row.mentor_name === 'Basavaraj Hiremath', `mentor_name=${row.mentor_name}`);
check('a two-hop field on a different branch',
  row.class_name === 'Class 9' && row.section_name === 'A', `${row.class_name} / ${row.section_name}`);
check('the intermediate record still gives its own field',
  row.faculty_code === 'FAC001', row.faculty_code);

check('references come back as plain ids, as the flat row had them',
  typeof row.student_id === 'string' && row.student_id === String(pupil._id), row.student_id);
check('and the record keeps its own id', row.id === String(record._id));

/* A reference that is absent must not throw, and must read as nothing. */
const orphan = await M.MentoringRecord.create({
  campus_id: campus._id, student_id: pupil._id, mentor_id: mentor._id,
  meeting_date: '2026-09-02', record_type: 'MEETING', title: 'No section',
});
await M.Student.updateOne({ _id: pupil._id }, { $unset: { section_id: 1 } });
const second = lift(await M.MentoringRecord.findById(orphan._id).populate(spec), mapping);
check('a missing reference reads as null rather than throwing', second.section_name === null,
  `section_name=${JSON.stringify(second.section_name)}`);

await mongo.stop();

const failed = results.filter((x) => !x).length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
