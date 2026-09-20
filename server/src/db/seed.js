/**
 * Demo data seeder for the Vignan ERP.
 *
 *   node src/db/seed.js
 *
 * Creates a fully populated institution: two campuses, three academic years,
 * staff across both faculty categories, classes with sections, courses and
 * assignments, students with linked parent accounts (including one parent with
 * two children in different classes), attendance history, examinations with the
 * complete marks approval chain, fees with payments and receipts, payroll,
 * transport, library, inventory, communications and audit trail.
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import env from '../config/env.js';
import { all, get, run, insert, update, scalar, exec, transaction, close } from './connection.js';
import { amountInWords } from '../lib/money.js';

/**
 * Sequential array helpers.
 *
 * The seeder's rows reference each other by id, so inserts have to happen in a
 * fixed order — `.forEach` does not wait for an async callback, and
 * `Promise.all` would let the database hand out ids in whatever order the
 * inserts finished. These wait for each one.
 */
const seqMap = async (items, fn) => {
  const out = [];
  for (const [index, item] of items.entries()) out.push(await fn(item, index));
  return out;
};
const seqEach = async (items, fn) => {
  for (const [index, item] of items.entries()) await fn(item, index);
};


const PASSWORD = env.seedPassword;
const passwordHash = bcrypt.hashSync(PASSWORD, 10);

// Deterministic PRNG so repeated seeds produce the same demo institution.
let seedState = 20260826;
const rnd = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (p) => rnd() < p;
const iso = (date) => date.toISOString().slice(0, 10);

/** Residential areas around Raichur, used for student and parent addresses. */
const LOCALITIES = [
  'Basavanagar', 'Gunj Circle', 'Station Road', 'Ashok Nagar', 'Navrang Gate',
  'LBS Nagar', 'Deosugur', 'Yeramarus', 'Shakti Nagar', 'Mavinkere',
];

/** The two departments (examination boards) the school runs. */
const BOARDS = [
  { code: 'STATE', label: 'State Board', levels: 10, sections: (level) => (level >= 5 ? ['A', 'B'] : ['A']) },
  // The CBSE wing runs senior secondary as well, so it goes up to Class 12.
  { code: 'CBSE', label: 'CBSE', levels: 12, sections: () => ['A'] },
];

/** Class 11 and 12 are senior secondary and carry a stream. */
const SENIOR_LEVEL = 11;
const streamFor = (level, board) => (board === 'CBSE' && level >= SENIOR_LEVEL ? 'Science' : null);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
const daysAhead = (n) => iso(new Date(Date.now() + n * 86400000));

console.log('Seeding Vignan ERP demo data...\n');

/**
 * Course materials point at real files on disk, so a student can genuinely
 * preview and download them. A small set is generated once and shared across
 * the seeded materials.
 */
const MATERIALS_DIR = path.join(env.uploadDir, 'materials');
fs.mkdirSync(MATERIALS_DIR, { recursive: true });

function writeNotesPdf(fileName, title, lines) {
  return new Promise((resolve, reject) => {
    const target = path.join(MATERIALS_DIR, fileName);
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const stream = fs.createWriteStream(target);
    doc.pipe(stream);

    doc.rect(0, 0, doc.page.width, 96).fill('#12305a');
    doc.fillColor('#ffffff').fontSize(20).text('Vignan Vidyalayam, Raichur', 56, 34);
    doc.fontSize(10).fillColor('#c7d6ec').text('Course material', 56, 62);

    doc.moveDown(3);
    doc.fillColor('#0f172a').fontSize(17).text(title, 56, 130);
    doc.moveTo(56, 158).lineTo(doc.page.width - 56, 158).strokeColor('#e2e8f0').stroke();

    doc.moveDown(1.5).fontSize(11).fillColor('#334155');
    lines.forEach((line) => {
      doc.moveDown(0.6);
      doc.text(line, { width: doc.page.width - 112, align: 'left' });
    });

    doc.fontSize(8).fillColor('#94a3b8').text(
      'Shared through the Vignan ERP student portal.',
      56,
      doc.page.height - 60,
      { width: doc.page.width - 112, align: 'center' }
    );

    doc.end();
    stream.on('finish', () => resolve({
      path: `/uploads/materials/${fileName}`,
      name: `${title.replace(/[^A-Za-z0-9 ]/g, '')}.pdf`,
      size: fs.statSync(target).size,
    }));
    stream.on('error', reject);
  });
}

function writeNotesText(fileName, title, body) {
  const target = path.join(MATERIALS_DIR, fileName);
  fs.writeFileSync(target, body, 'utf8');
  return {
    path: `/uploads/materials/${fileName}`,
    name: `${title.replace(/[^A-Za-z0-9 ]/g, '')}.txt`,
    size: fs.statSync(target).size,
  };
}

const MATERIAL_FILES = [
  await writeNotesPdf('seed-notes-algebra.pdf', 'Algebra — Linear Equations', [
    'A linear equation in one variable can be written as ax + b = 0, where a is not zero.',
    'Worked example: solve 3x + 12 = 0.  Subtract 12 from both sides to get 3x = -12, then divide by 3 so x = -4.',
    'Practice: 5x - 20 = 0,  2x + 7 = 19,  4(x - 3) = 8.',
    'Remember to verify each answer by substituting it back into the original equation.',
  ]),
  await writeNotesPdf('seed-notes-motion.pdf', 'Physics — Laws of Motion', [
    'Newton\'s first law: a body continues in its state of rest or uniform motion unless acted upon by an external force.',
    'Newton\'s second law: F = ma. Force is proportional to the rate of change of momentum.',
    'Newton\'s third law: for every action there is an equal and opposite reaction.',
    'Classroom activity: measure the acceleration of a trolley under different loads and plot F against a.',
  ]),
  await writeNotesPdf('seed-notes-photosynthesis.pdf', 'Biology — Photosynthesis', [
    'Photosynthesis converts light energy into chemical energy stored as glucose.',
    'The overall reaction: 6CO2 + 6H2O  ->  C6H12O6 + 6O2, in the presence of light and chlorophyll.',
    'The light reactions occur in the thylakoid membranes; the Calvin cycle occurs in the stroma.',
    'Revision question: explain why a variegated leaf shows starch only in its green regions.',
  ]),
  await writeNotesPdf('seed-worksheet-grammar.pdf', 'English — Tenses Worksheet', [
    'Section A: rewrite each sentence in the past perfect tense.',
    'Section B: identify the tense used in each of the ten sentences provided.',
    'Section C: write a short paragraph of your own using at least four different tenses.',
    'Submit the completed worksheet to your English teacher before the due date.',
  ]),
  writeNotesText(
    'seed-reading-list.txt',
    'Suggested Reading List',
    [
      'VIGNAN VIDYALAYAM, RAICHUR — SUGGESTED READING',
      '',
      '1. Wings of Fire — A.P.J. Abdul Kalam',
      '2. The Discovery of India — Jawaharlal Nehru',
      '3. Panchatantra Stories — Vishnu Sharma',
      '4. Treasure Island — R.L. Stevenson',
      '5. To Kill a Mockingbird — Harper Lee',
      '',
      'All titles are available in the school library. Ask the librarian to reserve a copy.',
    ].join('\n')
  ),
];
console.log(`· ${MATERIAL_FILES.length} material files written to uploads/materials`);

// Wipe transactional tables so the seed is repeatable (roles/permissions stay).
const WIPE = [
  'activity_logs', 'notifications', 'messages', 'events', 'circulars', 'notices', 'announcements',
  'assets', 'purchases', 'inventory_items', 'inventory_categories',
  'fines', 'book_transactions', 'books',
  'driver_attendance', 'vehicle_maintenance', 'fuel_records', 'transport_allocations', 'routes', 'drivers', 'vehicles',
  'payroll', 'salary_structures', 'petty_cash', 'expenses', 'income',
  'fee_receipts', 'fee_payments', 'student_fees', 'fee_structures', 'fee_categories',
  'mentoring_records', 'leave_requests', 'course_materials', 'timetables',
  'results', 'marks', 'grades', 'exam_subjects', 'examinations',
  'faculty_attendance', 'attendance', 'documents', 'enrollments',
  'student_parents', 'parents', 'students',
  'course_assignments', 'courses', 'subjects', 'sections', 'classes', 'academic_years',
  'faculty', 'administrators', 'departments',
  'user_permissions', 'refresh_tokens', 'users', 'system_settings', 'campuses',
];
// One statement does what three used to: empties the tables whatever order
// they reference each other in, and puts every id sequence back to 1 — which
// the tests rely on, since they name specific rows.
await exec(`TRUNCATE TABLE ${WIPE.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
console.log('· cleared previous demo data');

const roleId = async (code) => (await get('SELECT id FROM roles WHERE code = ?', [code])).id;

const seedAll = transaction(async () => {
  // ------------------------------------------------------------ campuses
  const campusId = await insert('campuses', {
    code: 'VGN-RCR',
    name: 'Vignan Vidyalayam, Raichur',
    address: 'Station Road, Basavanagar',
    city: 'Raichur',
    state: 'Karnataka',
    pincode: '584101',
    phone: '+91 8532 232 444',
    email: 'info@vignanraichur.edu.in',
    principal: 'Dr. Basavaraj Patil',
  });
  const campus2Id = await insert('campuses', {
    code: 'VGN-KLB',
    name: 'Vignan Vidyaniketan, Kalaburagi',
    address: 'Ring Road, Sedam Cross',
    city: 'Kalaburagi',
    state: 'Karnataka',
    pincode: '585105',
    phone: '+91 8472 245 678',
    email: 'kalaburagi@vignan.edu.in',
    principal: 'Mrs. Shobha Kulkarni',
  });
  console.log('· 2 campuses');

  // ------------------------------------------------------------ settings
  const settings = [
    ['GENERAL', 'institution_name', 'Vignan Educational Institutions', 'STRING', 'Institution Name', 1],
    ['GENERAL', 'tagline', 'Learning today, leading tomorrow', 'STRING', 'Tagline', 1],
    ['GENERAL', 'departments', 'State Board, CBSE', 'STRING', 'Departments Offered', 1],
    ['GENERAL', 'academic_session', '2025-26', 'STRING', 'Current Session', 1],
    ['GENERAL', 'contact_email', 'info@vignanraichur.edu.in', 'STRING', 'Public Contact Email', 1],
    ['GENERAL', 'contact_phone', '+91 8532 232 444', 'STRING', 'Public Contact Phone', 1],
    ['ACADEMIC', 'attendance_threshold', '75', 'NUMBER', 'Minimum Attendance %', 0],
    ['ACADEMIC', 'passing_percentage', '35', 'NUMBER', 'Passing Percentage', 0],
    // Per weekday (1 = Monday). A shorter Saturday, closed on Sunday.
    ['ACADEMIC', 'periods_per_day', '{"1":8,"2":8,"3":8,"4":8,"5":8,"6":4,"7":0}', 'JSON',
      'Periods Per Day', 0],
    ['ACADEMIC', 'working_days_per_week', '6', 'NUMBER', 'Working Days Per Week', 0],
    ['FINANCE', 'currency_symbol', 'INR', 'STRING', 'Currency', 1],
    ['FINANCE', 'late_fee_per_day', '10', 'NUMBER', 'Late Fee Per Day', 0],
    ['FINANCE', 'receipt_prefix', 'RCP', 'STRING', 'Receipt Prefix', 0],
    // 25 TB, expressed in the megabytes the setting is stored in.
    ['GENERAL', 'storage_limit_mb', '26214400', 'NUMBER', 'Storage Limit (MB)', 0],
    ['SECURITY', 'session_timeout_minutes', '30', 'NUMBER', 'Session Timeout', 0],
    ['SECURITY', 'max_login_attempts', '5', 'NUMBER', 'Max Login Attempts', 0],
    ['SECURITY', 'password_min_length', '8', 'NUMBER', 'Minimum Password Length', 0],
    ['LIBRARY', 'loan_days', '14', 'NUMBER', 'Default Loan Period (days)', 0],
    ['LIBRARY', 'fine_per_day', '2', 'NUMBER', 'Library Fine Per Day', 0],
  ];
  for (const [category, key, value, valueType, label, isPublic] of settings) {
    await insert('system_settings', {
      campus_id: campusId,
      category,
      key,
      value,
      value_type: valueType,
      label,
      is_public: isPublic,
    });
  }

  // ------------------------------------------------------- academic years
  const year2024 = await insert('academic_years', {
    campus_id: campusId, name: '2024-25', start_date: '2024-06-01', end_date: '2025-04-30',
    is_current: 0, status: 'CLOSED',
  });
  const year2025 = await insert('academic_years', {
    campus_id: campusId, name: '2025-26', start_date: '2025-06-01', end_date: '2026-04-30',
    is_current: 1, status: 'ACTIVE',
  });
  const year2026 = await insert('academic_years', {
    campus_id: campusId, name: '2026-27', start_date: '2026-06-01', end_date: '2027-04-30',
    is_current: 0, status: 'UPCOMING',
  });
  await insert('academic_years', {
    campus_id: campus2Id, name: '2025-26', start_date: '2025-06-01', end_date: '2026-04-30',
    is_current: 1, status: 'ACTIVE',
  });
  console.log('· 3 academic years (2025-26 current)');

  // --------------------------------------------------------- departments
  const departmentNames = [
    ['SCI', 'Science'], ['MAT', 'Mathematics'], ['ENG', 'English & Languages'],
    ['SOC', 'Social Studies'], ['COM', 'Computer Science'], ['PHY', 'Physical Education'],
    ['ADM', 'Administration'], ['FIN', 'Accounts & Finance'],
  ];
  const departments = {};
  for (const [code, name] of departmentNames) {
    departments[code] = await insert('departments', { campus_id: campusId, code, name });
  }

  // -------------------------------------------------------------- grades
  const gradeBands = [
    ['A+', 'Outstanding', 90, 100, 10, 'Excellent performance'],
    ['A', 'Excellent', 80, 89.99, 9, 'Very good performance'],
    ['B+', 'Very Good', 70, 79.99, 8, 'Good performance'],
    ['B', 'Good', 60, 69.99, 7, 'Above average'],
    ['C', 'Satisfactory', 50, 59.99, 6, 'Satisfactory'],
    ['D', 'Pass', 35, 49.99, 5, 'Needs improvement'],
    ['F', 'Fail', 0, 34.99, 0, 'Must reappear'],
  ];
  for (const [code, name, min, max, point, remarks] of gradeBands) {
    await insert('grades', {
      campus_id: campusId, code, name, min_percent: min, max_percent: max, grade_point: point, remarks,
    });
  }

  // ---------------------------------------------------------- admin user
  const adminUserId = await insert('users', {
    campus_id: campusId,
    role_id: await roleId('ADMIN'),
    username: 'admin',
    email: 'admin@vignan.edu.in',
    password_hash: passwordHash,
    full_name: 'Dr. Rajesh Kumar Vignan',
    phone: '+91 98480 11111',
    gender: 'MALE',
    status: 'ACTIVE',
  });

  // ------------------------------------------------------ administrators
  const administratorSeed = [
    ['Shobha Deshpande', 'shobha', 'F', 'Chief Administrative Officer', 'ADM'],
    ['Mallikarjun Swamy', 'mallikarjun', 'M', 'Academic Administrator', 'ADM'],
  ];
  const administratorIds = [];
  await seqEach(administratorSeed, async ([name, username, gender, designation, dept], index) => {
    const userId = await insert('users', {
      campus_id: campusId,
      role_id: await roleId('ADMINISTRATOR'),
      username,
      email: `${username}@vignan.edu.in`,
      password_hash: passwordHash,
      full_name: name,
      phone: `+91 98480 2${String(index + 1).padStart(4, '0')}`,
      gender: gender === 'M' ? 'MALE' : 'FEMALE',
      created_by: adminUserId,
    });
    administratorIds.push(
      await insert('administrators', {
        user_id: userId,
        campus_id: campusId,
        employee_code: `VADM${String(index + 1).padStart(3, '0')}`,
        designation,
        department_id: departments[dept],
        date_of_joining: '2019-06-10',
        qualification: 'M.B.A., M.Ed.',
        address: 'Vignan Staff Quarters, Basavanagar, Raichur',
        emergency_contact: '+91 98480 90000',
      })
    );
  });

  // The second administrator is deliberately restricted, to demonstrate that
  // Admin controls what an Administrator may do.
  const restrictedAdmin = await get('SELECT user_id FROM administrators WHERE employee_code = ?', ['VADM002']);
  for (const code of ['students.delete', 'parents.delete', 'faculty.create']) {
    const permission = await get('SELECT id FROM permissions WHERE code = ?', [code]);
    await insert('user_permissions', {
      user_id: restrictedAdmin.user_id,
      permission_id: permission.id,
      effect: 'DENY',
      granted_by: adminUserId,
    });
  }
  console.log('· admin + 2 administrators');

  // ------------------------------------------------------------- faculty
  const teachingSeed = [
    ['Basavaraj Kulkarni', 'basavaraj', 'M', 'Senior Teacher', 'MAT', 'M.Sc. Mathematics, B.Ed.', 'Algebra & Calculus', 14],
    ['Sunanda Patil', 'sunanda', 'F', 'Senior Teacher', 'SCI', 'M.Sc. Physics, B.Ed.', 'Physics', 11],
    ['Anil Kumar Desai', 'anil.desai', 'M', 'Teacher', 'SCI', 'M.Sc. Chemistry, B.Ed.', 'Chemistry', 8],
    ['Sunitha Biradar', 'sunitha', 'F', 'Teacher', 'SCI', 'M.Sc. Botany, B.Ed.', 'Biology', 9],
    ['Ravindra Joshi', 'ravindra', 'M', 'Senior Teacher', 'ENG', 'M.A. English, B.Ed.', 'English Literature', 12],
    ['Sharanamma Hiremath', 'sharanamma', 'F', 'Teacher', 'ENG', 'M.A. Kannada, B.Ed.', 'Kannada', 7],
    ['Mohammed Irfan Khan', 'irfan.khan', 'M', 'Teacher', 'ENG', 'M.A. Hindi, B.Ed.', 'Hindi', 6],
    ['Shivanand Angadi', 'shivanand', 'M', 'Senior Teacher', 'SOC', 'M.A. History, B.Ed.', 'History & Civics', 15],
    ['Kavitha Nadgouda', 'kavitha', 'F', 'Teacher', 'SOC', 'M.A. Geography, B.Ed.', 'Geography', 8],
    ['Naveen Math', 'naveen', 'M', 'Teacher', 'COM', 'M.C.A.', 'Computer Science', 10],
    ['Divya Shetty', 'divya', 'F', 'Teacher', 'COM', 'B.Tech CSE, B.Ed.', 'Information Technology', 5],
    ['Prakash Gouda', 'prakash', 'M', 'Physical Director', 'PHY', 'M.P.Ed.', 'Sports & Athletics', 13],
    // CBSE wing counterparts, so the two departments are separately staffed.
    ['Girish Kulkarni', 'girish', 'M', 'Senior Teacher', 'MAT', 'M.Sc. Mathematics, B.Ed.', 'Mathematics (CBSE)', 12],
    ['Rekha Patil', 'rekha', 'F', 'Teacher', 'SCI', 'M.Sc. Physics, B.Ed.', 'Physics (CBSE)', 9],
    ['Vinod Kamath', 'vinod', 'M', 'Teacher', 'SCI', 'M.Sc. Chemistry, B.Ed.', 'Chemistry & Biology (CBSE)', 7],
    ['Asha Mundargi', 'asha', 'F', 'Senior Teacher', 'ENG', 'M.A. English, B.Ed.', 'English (CBSE)', 11],
    ['Vidya Hegde', 'vidya', 'F', 'Teacher', 'ENG', 'M.A. Kannada, B.Ed.', 'Kannada (CBSE)', 6],
    ['Sanjay Rathod', 'sanjay', 'M', 'Teacher', 'ENG', 'M.A. Hindi, B.Ed.', 'Hindi (CBSE)', 8],
    ['Nagaraj Bhat', 'nagaraj', 'M', 'Teacher', 'SOC', 'M.A. Political Science, B.Ed.', 'Social Studies (CBSE)', 10],
    ['Pooja Kittur', 'pooja', 'F', 'Teacher', 'COM', 'M.C.A.', 'Computer Science (CBSE)', 5],
  ];
  const teachers = [];
  await seqEach(teachingSeed, async ([name, username, gender, designation, dept, qualification, specialization, experience], index) => {
    const userId = await insert('users', {
      campus_id: campusId,
      role_id: await roleId('TEACHING_STAFF'),
      username,
      email: `${username}@vignan.edu.in`,
      password_hash: passwordHash,
      full_name: name,
      phone: `+91 98481 ${String(1000 + index)}`,
      gender: gender === 'M' ? 'MALE' : 'FEMALE',
      created_by: adminUserId,
    });
    const facultyId = await insert('faculty', {
      user_id: userId,
      campus_id: campusId,
      faculty_code: `VFT${String(index + 1).padStart(4, '0')}`,
      staff_type: 'TEACHING',
      // Set from the courses actually assigned, once assignments exist.
      board: 'BOTH',
      department_id: departments[dept],
      designation,
      qualification,
      specialization,
      experience_years: experience,
      date_of_birth: `19${between(70, 92)}-0${between(1, 9)}-1${between(0, 9)}`,
      date_of_joining: `20${between(10, 22)}-06-15`,
      blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'O-']),
      address: `${between(1, 99)}, Vignan Colony, Basavanagar, Raichur`,
      emergency_contact: `+91 90000 ${String(10000 + index).slice(0, 5)}`,
      bank_account: `3421${String(1000000 + index * 137)}`,
      pan_number: `ABCPV${between(1000, 9999)}${pick(['A', 'K', 'M', 'R'])}`,
      is_mentor: 0, // set below, once mentees have actually been allotted
    });
    teachers.push({ id: facultyId, userId, name, dept });
  });

  const financialSeed = [
    ['Gurunath Kulkarni', 'gurunath', 'M', 'Accounts Manager', 'B.Com, M.Com, CA (Inter)'],
    ['Saraswati Naik', 'saraswati', 'F', 'Fee Collection Officer', 'B.Com'],
    ['Harish Biradar', 'harish', 'M', 'Accounts Assistant', 'B.Com, Tally Certified'],
  ];
  const financialStaff = [];
  await seqEach(financialSeed, async ([name, username, gender, designation, qualification], index) => {
    const userId = await insert('users', {
      campus_id: campusId,
      role_id: await roleId('FINANCIAL_STAFF'),
      username,
      email: `${username}@vignan.edu.in`,
      password_hash: passwordHash,
      full_name: name,
      phone: `+91 98482 ${String(2000 + index)}`,
      gender: gender === 'M' ? 'MALE' : 'FEMALE',
      created_by: adminUserId,
    });
    const facultyId = await insert('faculty', {
      user_id: userId,
      campus_id: campusId,
      faculty_code: `VFF${String(index + 1).padStart(4, '0')}`,
      staff_type: 'FINANCIAL',
      board: 'BOTH',
      department_id: departments.FIN,
      designation,
      qualification,
      experience_years: between(4, 16),
      date_of_joining: `20${between(12, 22)}-04-01`,
      address: `${between(1, 99)}, Gunj Circle, Raichur`,
      bank_account: `3421${String(2000000 + index * 211)}`,
      pan_number: `FINPV${between(1000, 9999)}Z`,
    });
    financialStaff.push({ id: facultyId, userId, name });
  });
  console.log(`· ${teachers.length} teaching staff, ${financialStaff.length} financial staff`);

  // Departments get heads.
  await update('departments', departments.MAT, { head_faculty_id: teachers[0].id });
  await update('departments', departments.SCI, { head_faculty_id: teachers[1].id });
  await update('departments', departments.ENG, { head_faculty_id: teachers[4].id });
  await update('departments', departments.SOC, { head_faculty_id: teachers[7].id });
  await update('departments', departments.COM, { head_faculty_id: teachers[9].id });

  // ------------------------------------------------------------ subjects
  const subjectSeed = [
    ['MATH', 'Mathematics', 'MAT', 'CORE'],
    ['SCI', 'General Science', 'SCI', 'CORE'],
    ['PHY', 'Physics', 'SCI', 'CORE'],
    ['CHEM', 'Chemistry', 'SCI', 'CORE'],
    ['BIO', 'Biology', 'SCI', 'CORE'],
    ['ENG', 'English', 'ENG', 'LANGUAGE'],
    ['KAN', 'Kannada', 'ENG', 'LANGUAGE'],
    ['HIN', 'Hindi', 'ENG', 'LANGUAGE'],
    ['SOC', 'Social Studies', 'SOC', 'CORE'],
    ['CS', 'Computer Science', 'COM', 'ELECTIVE'],
    ['PE', 'Physical Education', 'PHY', 'ACTIVITY'],
  ];
  const subjects = {};
  for (const [code, name, dept, type] of subjectSeed) {
    subjects[code] = await insert('subjects', {
      campus_id: campusId, code, name, department_id: departments[dept], type,
    });
  }

  // ---------------------------------------------- classes, sections, courses
  // Each department runs its own ladder of classes, so "Class 8" exists once
  // in the State wing and once in the CBSE wing.
  const classes = [];
  const sections = [];
  let teacherCursor = 0;
  for (const board of BOARDS) {
    for (let level = 1; level <= board.levels; level += 1) {
      const classId = await insert('classes', {
        campus_id: campusId,
        academic_year_id: year2025,
        name: `Class ${level}`,
        numeric_level: level,
        stream: streamFor(level, board.code),
        board: board.code,
        class_teacher_id: teachers[teacherCursor++ % teachers.length].id,
      });
      classes.push({ id: classId, level, name: `Class ${level}`, board: board.code });

      await seqEach(board.sections(level), async (sectionName, sIndex) => {
        const sectionId = await insert('sections', {
          campus_id: campusId,
          class_id: classId,
          name: sectionName,
          capacity: 40,
          room_number: `${board.code === 'CBSE' ? 'C' : 'S'}${level}0${sIndex + 1}`,
          section_teacher_id: teachers[teacherCursor++ % teachers.length].id,
        });
        sections.push({
          id: sectionId,
          classId,
          level,
          board: board.code,
          name: sectionName,
          label: `${level}${sectionName}`,
        });
      });
    }
  }

  // Subject mix per level. The State wing leads with Kannada; the CBSE wing
  // leads with Hindi and introduces Computer Science a year earlier.
  const subjectsForLevel = (level, board) => {
    // Senior secondary is a science group: no second language, no Social Studies.
    if (level >= SENIOR_LEVEL) return ['ENG', 'PHY', 'CHEM', 'MATH', 'BIO', 'CS', 'PE'];

    const base = ['MATH', 'ENG', 'SOC', 'PE'];
    const language = board === 'CBSE' ? ['HIN', 'KAN'] : ['KAN', 'HIN'];
    if (level <= 6) {
      return [...base, ...language, 'SCI', ...(board === 'CBSE' && level >= 5 ? ['CS'] : [])];
    }
    return [...base, ...language, 'PHY', 'CHEM', 'BIO', 'CS'];
  };

  // Each wing has its own subject teachers; Physical Education is shared.
  const TEACHER_BY_SUBJECT = {
    STATE: {
      MATH: [0], PHY: [1], CHEM: [2], BIO: [3], SCI: [1, 2, 3],
      ENG: [4], KAN: [5], HIN: [6], SOC: [7, 8], CS: [9, 10], PE: [11],
    },
    CBSE: {
      MATH: [12], PHY: [13], CHEM: [14], BIO: [14], SCI: [13, 14],
      ENG: [15], KAN: [16], HIN: [17], SOC: [18], CS: [19], PE: [11],
    },
  };

  const teacherForSubject = (code, board) => {
    const map = TEACHER_BY_SUBJECT[board] || TEACHER_BY_SUBJECT.STATE;
    const candidates = map[code] || map.MATH;
    return teachers[candidates[Math.floor(rnd() * candidates.length)]];
  };

  const courses = [];
  for (const klass of classes) {
    for (const subjectCode of subjectsForLevel(klass.level, klass.board)) {
      const courseId = await insert('courses', {
        campus_id: campusId,
        academic_year_id: year2025,
        subject_id: subjects[subjectCode],
        class_id: klass.id,
        code: `${subjectCode}-${klass.board === 'CBSE' ? 'C' : 'S'}${klass.level}`,
        name:
          `${subjectSeed.find((s) => s[0] === subjectCode)[1]} — Class ${klass.level}` +
          ` (${klass.board === 'CBSE' ? 'CBSE' : 'State'}${klass.level >= SENIOR_LEVEL ? ' Science' : ''})`,
        description: `Class ${klass.level} ${klass.board} syllabus for ${subjectCode}.`,
        credits: subjectCode === 'PE' ? 2 : 4,
        max_marks: subjectCode === 'PE' ? 50 : 100,
        pass_marks: subjectCode === 'PE' ? 18 : 35,
      });
      courses.push({ id: courseId, classId: klass.id, level: klass.level, subjectCode, board: klass.board });

      // Assign a teacher to every section of that class.
      for (const section of sections.filter((s) => s.classId === klass.id)) {
        const teacher = teacherForSubject(subjectCode, klass.board);
        await insert('course_assignments', {
          campus_id: campusId,
          course_id: courseId,
          faculty_id: teacher.id,
          section_id: section.id,
          academic_year_id: year2025,
          assigned_by: administratorIds.length ? adminUserId : adminUserId,
        });
      }
    }
  }
  // A teacher belongs to the wing(s) they actually teach in — BOTH when they
  // cross departments, which is how Physical Education works here.
  for (const teacher of teachers) {
    const wings = (await all(
      `SELECT DISTINCT c.board FROM course_assignments ca
         JOIN sections sec ON sec.id = ca.section_id
         JOIN classes c ON c.id = sec.class_id
        WHERE ca.faculty_id = ?`,
      [teacher.id]
    )).map((r) => r.board);
    const board = wings.length === 1 ? wings[0] : 'BOTH';
    await update('faculty', teacher.id, { board });
    teacher.board = board;
  }

  console.log(`· ${classes.length} classes, ${sections.length} sections, ${courses.length} courses`);

  // ----------------------------------------------------------- timetable
  //
  // Every section gets a full week. The old generator dropped a slot whenever
  // the teacher was already booked, which left more than half the sections with
  // no timetable at all and their pupils looking at an empty page. Instead, try
  // each of the section's courses in turn and take the first whose teacher is
  // free — only a genuinely impossible period is left blank.
  const periodTimes = [
    ['09:00', '09:45'], ['09:45', '10:30'], ['10:45', '11:30'], ['11:30', '12:15'],
    ['13:00', '13:45'], ['13:45', '14:30'], ['14:45', '15:30'], ['15:30', '16:15'],
  ];
  // Matches the seeded `periods_per_day`: a shorter Saturday, closed on Sunday.
  const periodsOnDay = { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4, 7: 0 };

  // faculty_id -> Set('day:period'), so a clash is a lookup rather than a query.
  const booked = new Map();
  const isBusy = (facultyId, day, period) =>
    facultyId != null && booked.get(facultyId)?.has(`${day}:${period}`);
  const book = (facultyId, day, period) => {
    if (facultyId == null) return;
    if (!booked.has(facultyId)) booked.set(facultyId, new Set());
    booked.get(facultyId).add(`${day}:${period}`);
  };

  let slotCount = 0;
  for (const section of sections) {
    const sectionCourses = courses.filter((c) => c.classId === section.classId);
    if (!sectionCourses.length) continue;

    // Who teaches each of this section's courses, resolved once per section.
    const teacherFor = new Map(
      await seqMap(sectionCourses, async (course) => [
        course.id,
        (await get('SELECT faculty_id FROM course_assignments WHERE course_id = ? AND section_id = ?', [
          course.id,
          section.id,
        ]))?.faculty_id ?? null,
      ])
    );

    for (let day = 1; day <= 6; day += 1) {
      for (let period = 1; period <= periodsOnDay[day]; period += 1) {
        // Start where the plain rotation would land, then walk the rest of the
        // section's courses until one has a teacher who is free this period.
        const offset = (day * 6 + period) % sectionCourses.length;
        let course = null;
        for (let n = 0; n < sectionCourses.length; n += 1) {
          const candidate = sectionCourses[(offset + n) % sectionCourses.length];
          if (!isBusy(teacherFor.get(candidate.id), day, period)) {
            course = candidate;
            break;
          }
        }
        // The demo roster is smaller than the timetable it has to fill, so the
        // senior classes can reach a period where every one of their teachers is
        // already in another room. The period still exists for those pupils —
        // it is placed with the teacher left blank for the office to assign,
        // rather than leaving the section with no timetable at all.
        const placed = course ?? sectionCourses[offset];
        const facultyId = course ? teacherFor.get(placed.id) : null;
        await insert('timetables', {
          campus_id: campusId,
          academic_year_id: year2025,
          class_id: section.classId,
          section_id: section.id,
          course_id: placed.id,
          faculty_id: facultyId,
          day_of_week: day,
          period,
          start_time: periodTimes[period - 1][0],
          end_time: periodTimes[period - 1][1],
          room: `${section.level}0${section.name === 'A' ? 1 : 2}`,
        });
        book(facultyId, day, period);
        slotCount += 1;
      }
    }
  }
  console.log(`· weekly timetable generated (${slotCount} slots across ${sections.length} sections)`);

  // ------------------------------------------------------------ students
  const firstNamesM = ['Aarav', 'Vihaan', 'Basavaraj', 'Shivakumar', 'Rohan', 'Karthik', 'Aditya', 'Nikhil', 'Mallikarjun', 'Praneeth', 'Veeresh', 'Yashwanth', 'Sangamesh', 'Manoj', 'Siddharth'];
  const firstNamesF = ['Ananya', 'Divya', 'Sneha', 'Shruthi', 'Keerthi', 'Meghana', 'Nandini', 'Pooja', 'Rachana', 'Sahana', 'Tejaswini', 'Varsha', 'Yamini', 'Bhavana', 'Lakshmi'];
  const surnames = ['Patil', 'Hiremath', 'Kulkarni', 'Desai', 'Gouda', 'Naik', 'Biradar', 'Kumar', 'Shetty', 'Joshi', 'Angadi', 'Math', 'Nadgouda', 'Reddy', 'Yadav'];
  const occupations = ['Software Engineer', 'Farmer', 'Doctor', 'Businessman', 'Teacher', 'Bank Officer', 'Advocate', 'Government Employee'];

  const students = [];
  let admissionCounter = 1;

  for (const section of sections) {
    const strength = section.board === 'CBSE' ? between(12, 18) : section.level <= 4 ? between(16, 20) : between(18, 24);
    for (let i = 1; i <= strength; i += 1) {
      const isMale = chance(0.52);
      const firstName = isMale ? pick(firstNamesM) : pick(firstNamesF);
      const surname = pick(surnames);
      const admissionNumber = `VGN2025-${String(admissionCounter).padStart(4, '0')}`;
      const username = admissionNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
      const birthYear = 2026 - (section.level + 5);

      const userId = await insert('users', {
        campus_id: campusId,
        role_id: await roleId('STUDENT'),
        username,
        email: `${username}@student.vignan.edu.in`,
        password_hash: passwordHash,
        full_name: `${firstName} ${surname}`,
        gender: isMale ? 'MALE' : 'FEMALE',
        // A pupil's records are reached through their parent, so the account
        // exists to own them but cannot be signed into.
        status: 'INACTIVE',
        created_by: adminUserId,
      });

      const studentId = await insert('students', {
        user_id: userId,
        campus_id: campusId,
        board: section.board,
        admission_number: admissionNumber,
        roll_number: String(i),
        first_name: firstName,
        last_name: surname,
        date_of_birth: `${birthYear}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`,
        gender: isMale ? 'MALE' : 'FEMALE',
        blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'O-']),
        class_id: section.classId,
        section_id: section.id,
        academic_year_id: year2025,
        mentor_id: null, // allotted below from the teachers of this section
        phone: `+91 9${between(100000000, 999999999)}`,
        email: `${username}@student.vignan.edu.in`,
        address: `${between(1, 200)}, ${pick(LOCALITIES)}, Raichur`,
        city: 'Raichur',
        state: 'Karnataka',
        pincode: '5841' + between(10, 99),
        religion: pick(['Hindu', 'Muslim', 'Christian']),
        category: pick(['GEN', 'OBC', 'SC', 'ST']),
        previous_school: chance(0.3) ? pick(['Little Flower School', 'Sri Chaitanya', 'Bhashyam Public School']) : null,
        admission_date: section.level === 1 ? '2025-06-05' : `20${between(18, 25)}-06-10`,
        status: 'ACTIVE',
      });

      students.push({
        id: studentId,
        userId,
        admissionNumber,
        firstName,
        surname,
        classId: section.classId,
        sectionId: section.id,
        level: section.level,
        board: section.board,
        label: section.label,
        roll: i,
      });

      await insert('enrollments', {
        campus_id: campusId,
        student_id: studentId,
        academic_year_id: year2025,
        class_id: section.classId,
        section_id: section.id,
        roll_number: String(i),
        enrollment_date: '2025-06-05',
      });

      admissionCounter += 1;
    }
  }
  /**
   * Every student gets a mentor drawn from the teachers who actually take
   * their section, so a CBSE student is mentored by a CBSE teacher and the
   * load is spread evenly instead of landing on a handful of staff.
   */
  const mentorLoad = new Map();
  for (const student of students) {
    const candidates = (await all(
      `SELECT DISTINCT ca.faculty_id FROM course_assignments ca
        WHERE ca.section_id = ? AND ca.status = 'ACTIVE'`,
      [student.sectionId]
    )).map((r) => r.faculty_id);
    if (!candidates.length) continue;

    // Whoever among this section's teachers currently carries the fewest.
    candidates.sort((a, b) => (mentorLoad.get(a) ?? 0) - (mentorLoad.get(b) ?? 0));
    const mentorId = candidates[0];
    mentorLoad.set(mentorId, (mentorLoad.get(mentorId) ?? 0) + 1);
    await update('students', student.id, { mentor_id: mentorId });
    student.mentorId = mentorId;
  }
  for (const facultyId of mentorLoad.keys()) await update('faculty', facultyId, { is_mentor: 1 });

  console.log(
    `· ${students.length} students enrolled · mentoring spread across ${mentorLoad.size} teachers ` +
      `(${Math.min(...mentorLoad.values())}-${Math.max(...mentorLoad.values())} mentees each)`
  );

  // ------------------------------------------------------------- parents
  // Most parents have one child; a few have two in different classes, which is
  // the multi-child case the parent portal must support.
  const parents = [];
  const unassigned = [...students];

  while (unassigned.length) {
    const child = unassigned.shift();
    const linked = [child];

    /*
     * Siblings. Most families have one child at the school, some have two, and
     * a few have three — the portal has to hold all three cases, so the demo
     * contains all three.
     *
     * A sibling is taken from a different class, preferring the same surname so
     * the family reads as a family, and never a class the parent already has a
     * child in — otherwise the switcher would show two identical-looking rows.
     */
    const takeSibling = () => {
      const levels = new Set(linked.map((c) => c.level));
      // Siblings share a surname but not a first name — two children called the
      // same thing would make the switcher unreadable.
      const names = new Set(linked.map((c) => c.firstName));
      const eligible = (s) => !levels.has(s.level) && !names.has(s.firstName);
      const bySurname = unassigned.findIndex((s) => eligible(s) && s.surname === child.surname);
      const anyOther = unassigned.findIndex(eligible);
      const index = bySurname >= 0 ? bySurname : anyOther;
      if (index >= 0) linked.push(unassigned.splice(index, 1)[0]);
    };

    if (chance(0.18)) takeSibling();
    // Of those with a second child, about a third have a third.
    if (linked.length > 1 && chance(0.33)) takeSibling();

    const fatherName = `${pick(firstNamesM)} ${child.surname}`;
    const motherName = `${pick(firstNamesF)} ${child.surname}`;
    const parentCode = `PRN${String(2000 + parents.length).padStart(6, '0')}`;
    const username = `p${child.admissionNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const parentUserId = await insert('users', {
      campus_id: campusId,
      role_id: await roleId('PARENT'),
      username,
      email: `${username}@parent.vignan.edu.in`,
      password_hash: passwordHash,
      full_name: fatherName,
      phone: `+91 9${between(100000000, 999999999)}`,
      gender: 'MALE',
      created_by: adminUserId,
    });

    const parentId = await insert('parents', {
      user_id: parentUserId,
      campus_id: campusId,
      parent_code: parentCode,
      father_name: fatherName,
      father_occupation: pick(occupations),
      father_phone: `+91 9${between(100000000, 999999999)}`,
      mother_name: motherName,
      mother_occupation: pick([...occupations, 'Homemaker', 'Homemaker']),
      mother_phone: `+91 9${between(100000000, 999999999)}`,
      relation: 'FATHER',
      email: `${username}@parent.vignan.edu.in`,
      phone: `+91 9${between(100000000, 999999999)}`,
      address: `${between(1, 200)}, ${pick(LOCALITIES)}, Raichur`,
      annual_income: between(2, 25) * 100000,
    });

    for (const linkedChild of linked) {
      await insert('student_parents', {
        student_id: linkedChild.id,
        parent_id: parentId,
        relation: 'FATHER',
        is_primary: 1,
      });
    }
    parents.push({ id: parentId, userId: parentUserId, username, children: linked });
  }
  const multiChild = parents.filter((p) => p.children.length > 1);
  const threeChild = parents.filter((p) => p.children.length > 2);
  console.log(
    `· ${parents.length} parent accounts ` +
      `(${multiChild.length} with more than one child, ${threeChild.length} with three)`
  );
  // Named in the credentials table below, so the demo always has a family of
  // three to switch between rather than whichever one the shuffle produced.
  const demoFamily = threeChild[0] ?? multiChild[0] ?? parents[0];

  // ---------------------------------------------------------- attendance
  // Sixty calendar days of daily attendance, skipping Sundays.
  let attendanceRows = 0;
  for (let dayOffset = 60; dayOffset >= 1; dayOffset -= 1) {
    const date = new Date(Date.now() - dayOffset * 86400000);
    if (date.getDay() === 0) continue;
    const dateString = iso(date);

    for (const student of students) {
      // Most students are present; the rest are absent.
      const status = rnd() < 0.93 ? 'PRESENT' : 'ABSENT';
      const marker = await get(
        `SELECT f.user_id FROM course_assignments ca JOIN faculty f ON f.id = ca.faculty_id
          WHERE ca.section_id = ? LIMIT 1`,
        [student.sectionId]
      );
      await insert('attendance', {
        campus_id: campusId,
        student_id: student.id,
        section_id: student.sectionId,
        academic_year_id: year2025,
        attendance_date: dateString,
        period: 0,
        status,
        marked_by: marker?.user_id ?? adminUserId,
      });
      attendanceRows += 1;
    }
  }
  console.log(`· ${attendanceRows} student attendance records (60 days)`);

  // Staff attendance for the last 30 days.
  const allStaff = [...teachers, ...financialStaff];
  for (let dayOffset = 30; dayOffset >= 1; dayOffset -= 1) {
    const date = new Date(Date.now() - dayOffset * 86400000);
    if (date.getDay() === 0) continue;
    for (const staff of allStaff) {
      const roll = rnd();
      await insert('faculty_attendance', {
        campus_id: campusId,
        faculty_id: staff.id,
        attendance_date: iso(date),
        status: roll < 0.93 ? 'PRESENT' : roll < 0.97 ? 'LEAVE' : 'ABSENT',
        check_in: '08:45',
        check_out: '16:30',
        marked_by: adminUserId,
      });
    }
  }

  // ------------------------------------------------------------- library
  const bookSeed = [
    ['9780143441748', 'Wings of Fire', 'A.P.J. Abdul Kalam', 'Universities Press', 'Biography', 12],
    ['9780141354828', 'Matilda', 'Roald Dahl', 'Puffin', 'Fiction', 8],
    ['9788126415747', 'Discovery of India', 'Jawaharlal Nehru', 'Penguin', 'History', 6],
    ['9780194529174', 'Oxford English Dictionary', 'Oxford', 'Oxford Press', 'Reference', 15],
    ['9788121924177', 'Fundamentals of Physics', 'Halliday & Resnick', 'Wiley', 'Science', 10],
    ['9789352533190', 'NCERT Mathematics Class 10', 'NCERT', 'NCERT', 'Textbook', 30],
    ['9788173711466', 'Panchatantra Stories', 'Vishnu Sharma', 'Amar Chitra Katha', 'Children', 20],
    ['9780553213119', 'Treasure Island', 'R.L. Stevenson', 'Bantam', 'Fiction', 7],
    ['9788129135728', 'The Immortals of Meluha', 'Amish Tripathi', 'Westland', 'Fiction', 9],
    ['9789389432060', 'Indian Polity', 'M. Laxmikanth', 'McGraw Hill', 'Reference', 5],
    ['9788187288831', 'Kannada Vyakarana', 'Kittel Ferdinand', 'Vignan Press', 'Language', 14],
    ['9780061120084', 'To Kill a Mockingbird', 'Harper Lee', 'Harper', 'Fiction', 6],
  ];
  const books = await seqMap(bookSeed, async ([isbn, title, author, publisher, category, copies], index) =>
    await insert('books', {
      campus_id: campusId,
      isbn,
      title,
      author,
      publisher,
      category,
      edition: `${between(1, 5)}th`,
      rack_number: `R${between(1, 12)}-S${between(1, 6)}`,
      total_copies: copies,
      available_copies: copies,
      price: between(150, 950),
      purchase_date: daysAgo(between(120, 900)),
    })
  );

  for (let i = 0; i < 40; i += 1) {
    const bookId = pick(books);
    const book = await get('SELECT * FROM books WHERE id = ?', [bookId]);
    if (book.available_copies < 1) continue;
    const student = pick(students);
    const issueDate = daysAgo(between(3, 40));
    const dueDate = iso(new Date(new Date(issueDate).getTime() + 14 * 86400000));
    const returned = chance(0.6);

    const transactionId = await insert('book_transactions', {
      campus_id: campusId,
      book_id: bookId,
      member_type: 'STUDENT',
      student_id: student.id,
      issue_date: issueDate,
      due_date: dueDate,
      return_date: returned ? daysAgo(between(0, 3)) : null,
      status: returned ? 'RETURNED' : new Date(dueDate) < new Date() ? 'OVERDUE' : 'ISSUED',
      issued_by: adminUserId,
    });
    if (!returned) await update('books', bookId, { available_copies: book.available_copies - 1 });

    if (!returned && new Date(dueDate) < new Date()) {
      const overdueDays = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
      await insert('fines', {
        campus_id: campusId,
        book_transaction_id: transactionId,
        student_id: student.id,
        fine_type: 'LATE_RETURN',
        amount: overdueDays * 2,
        reason: `${overdueDays} day(s) overdue`,
      });
    }
  }
  console.log(`· library: ${books.length} titles with circulation history`);

  // ----------------------------------------------------------- inventory
  const inventoryCategorySeed = [
    ['STAT', 'Stationery'], ['OFF', 'Office Supplies'], ['IT', 'Computers & IT Equipment'],
    ['FURN', 'Furniture'], ['LAB', 'Laboratory Equipment'], ['SPRT', 'Sports Materials'],
  ];
  const inventoryCategories = {};
  for (const [code, name] of inventoryCategorySeed) {
    inventoryCategories[code] = await insert('inventory_categories', { campus_id: campusId, code, name });
  }

  const itemSeed = [
    ['STAT', 'A4 Copier Paper (Ream)', 240, 'REAM', 50, 'Store Room A', 320],
    ['STAT', 'Whiteboard Marker', 480, 'PCS', 100, 'Store Room A', 35],
    ['STAT', 'Chalk Box', 150, 'BOX', 40, 'Store Room A', 60],
    ['OFF', 'Printer Toner Cartridge', 18, 'PCS', 6, 'Admin Office', 3200],
    ['OFF', 'File Folder', 300, 'PCS', 80, 'Admin Office', 45],
    ['IT', 'Desktop Computer', 62, 'PCS', 5, 'Computer Lab 1', 38000],
    ['IT', 'Projector', 14, 'PCS', 2, 'Smart Classrooms', 42000],
    ['IT', 'Network Switch 24-Port', 6, 'PCS', 2, 'Server Room', 12500],
    ['FURN', 'Student Desk', 640, 'PCS', 40, 'Classrooms', 2400],
    ['FURN', 'Staff Chair', 85, 'PCS', 10, 'Staff Room', 3600],
    ['LAB', 'Microscope', 24, 'PCS', 4, 'Biology Lab', 18500],
    ['LAB', 'Bunsen Burner', 40, 'PCS', 8, 'Chemistry Lab', 950],
    ['LAB', 'Physics Optics Kit', 15, 'SET', 3, 'Physics Lab', 7400],
    ['SPRT', 'Cricket Kit', 8, 'SET', 2, 'Sports Room', 8500],
    ['SPRT', 'Basketball', 24, 'PCS', 6, 'Sports Room', 1200],
    ['SPRT', 'Badminton Racket', 36, 'PCS', 10, 'Sports Room', 900],
  ];
  await seqEach(itemSeed, async ([category, name, quantity, unit, reorder, location, cost], index) => {
    await insert('inventory_items', {
      campus_id: campusId,
      category_id: inventoryCategories[category],
      item_code: `INV-${String(index + 1).padStart(4, '0')}`,
      name,
      quantity,
      unit,
      reorder_level: reorder,
      location,
      condition_status: pick(['NEW', 'GOOD', 'GOOD', 'FAIR']),
      purchase_date: daysAgo(between(30, 700)),
      vendor: pick(['Sri Basaveshwara Traders', 'Raichur Stationers', 'TechnoServe Systems', 'Sports World']),
      unit_cost: cost,
      department_id: category === 'IT' ? departments.COM : category === 'LAB' ? departments.SCI : departments.ADM,
    });
  });

  const assetSeed = [
    ['AST-0001', 'Dell OptiPlex Lab Server', 'IT Equipment', 'Server Room', 185000],
    ['AST-0002', 'School Generator 62.5 KVA', 'Utility', 'Utility Block', 425000],
    ['AST-0003', 'RO Water Purification Plant', 'Utility', 'Canteen Block', 165000],
    ['AST-0004', 'Smart Board — Class 10A', 'IT Equipment', 'Room 1001', 78000],
    ['AST-0005', 'Science Lab Fume Hood', 'Lab Equipment', 'Chemistry Lab', 92000],
  ];
  for (const [code, name, type, location, cost] of assetSeed) {
    await insert('assets', {
      campus_id: campusId,
      asset_code: code,
      name,
      asset_type: type,
      serial_number: `SN${between(100000, 999999)}`,
      purchase_date: daysAgo(between(200, 1400)),
      purchase_cost: cost,
      current_value: Math.round(cost * 0.78),
      vendor: pick(['TechnoServe Systems', 'Karnataka Electricals', 'AquaPure India']),
      location,
      department_id: departments.ADM,
      condition_status: 'GOOD',
      status: 'IN_USE',
    });
  }

  for (let i = 0; i < 12; i += 1) {
    const quantity = between(5, 60);
    const unitCost = between(80, 4200);
    await insert('purchases', {
      campus_id: campusId,
      purchase_order: `PO/2025/${String(100 + i)}`,
      item_name: pick(itemSeed)[1],
      vendor: pick(['Sri Basaveshwara Traders', 'Raichur Stationers', 'TechnoServe Systems']),
      quantity,
      unit_cost: unitCost,
      total_cost: quantity * unitCost,
      purchase_date: daysAgo(between(10, 300)),
      invoice_number: `INV${between(10000, 99999)}`,
      recorded_by: financialStaff[0].userId,
    });
  }
  console.log('· inventory, assets and purchase records');

  // ----------------------------------------------------------- transport
  const vehicleSeed = [
    ['KA36 B 1234', 'BUS', 'Tata Starbus 40', 40],
    ['KA36 B 1235', 'BUS', 'Ashok Leyland Lynx 45', 45],
    ['KA36 B 1236', 'BUS', 'Tata Starbus 40', 40],
    ['KA36 C 4410', 'MINI_BUS', 'Force Traveller 24', 24],
    ['KA36 C 4411', 'VAN', 'Mahindra Supro 12', 12],
  ];
  const vehicles = await seqMap(vehicleSeed, async ([number, type, model, capacity]) =>
    await insert('vehicles', {
      campus_id: campusId,
      vehicle_number: number,
      vehicle_type: type,
      model,
      capacity,
      registration_date: daysAgo(between(400, 2000)),
      insurance_expiry: daysAhead(between(20, 300)),
      fitness_expiry: daysAhead(between(40, 400)),
      status: 'ACTIVE',
    })
  );

  const driverSeed = [
    ['Basavaraj Nayak', '+91 90001 11101', 'KA36 20190001234'],
    ['Syed Basha', '+91 90001 11102', 'KA36 20180005678'],
    ['Hanumantha Naik', '+91 90001 11103', 'KA36 20200009012'],
    ['Mallikarjun Gouda', '+91 90001 11104', 'KA36 20170003456'],
    ['Shaik Mastan Vali', '+91 90001 11105', 'KA36 20210007890'],
  ];
  const drivers = await seqMap(driverSeed, async ([name, phone, license], index) =>
    await insert('drivers', {
      campus_id: campusId,
      name,
      phone,
      license_number: license,
      license_expiry: daysAhead(between(100, 900)),
      address: `${pick(['Basavanagar', 'Deosugur', 'Raichur'])}, Karnataka`,
      date_of_joining: daysAgo(between(300, 2000)),
      salary: between(16000, 24000),
      vehicle_id: vehicles[index],
    })
  );

  const routeSeed = [
    ['R01', 'Raichur City — Gunj Circuit', 'Gunj Circle', 'Vignan Campus', 12, 'Gunj Circle, Station Road, Basavanagar, Ashok Nagar'],
    ['R02', 'Sindhanur Express Route', 'Sindhanur Bus Stand', 'Vignan Campus', 28, 'Sindhanur, Turvihal, Maski'],
    ['R03', 'Deosugur — Shakti Nagar Local', 'Deosugur Village', 'Vignan Campus', 9, 'Deosugur, Shakti Nagar, Yeramarus'],
    ['R04', 'Manvi Corridor', 'Manvi Junction', 'Vignan Campus', 24, 'Manvi, Kavital, Sirwar'],
    ['R05', 'Lingsugur Feeder', 'Lingsugur Town', 'Vignan Campus', 20, 'Lingsugur, Mudgal, Hatti'],
  ];
  const routes = await seqMap(routeSeed, async ([code, name, start, end, distance, stops], index) =>
    await insert('routes', {
      campus_id: campusId,
      route_code: code,
      name,
      start_point: start,
      end_point: end,
      distance_km: distance,
      stops,
      vehicle_id: vehicles[index],
      driver_id: drivers[index],
      fare: 1500 + distance * 60,
      morning_start: '07:15',
      evening_start: '16:30',
    })
  );

  // About 45% of students use school transport.
  let allocations = 0;
  for (const student of students) {
    if (!chance(0.45)) continue;
    const routeIndex = between(0, routes.length - 1);
    const route = await get('SELECT * FROM routes WHERE id = ?', [routes[routeIndex]]);
    const stops = String(route.stops).split(',').map((s) => s.trim());
    await insert('transport_allocations', {
      campus_id: campusId,
      student_id: student.id,
      route_id: route.id,
      vehicle_id: route.vehicle_id,
      pickup_point: pick(stops),
      drop_point: pick(stops),
      pickup_time: `07:${String(between(15, 55)).padStart(2, '0')}`,
      drop_time: `16:${String(between(35, 59)).padStart(2, '0')}`,
      academic_year_id: year2025,
      fare: route.fare,
    });
    allocations += 1;
  }

  for (const vehicleId of vehicles) {
    for (let i = 0; i < 8; i += 1) {
      const litres = between(40, 90);
      const rate = 94 + rnd() * 8;
      await insert('fuel_records', {
        campus_id: campusId,
        vehicle_id: vehicleId,
        fuel_date: daysAgo(between(1, 180)),
        litres,
        rate_per_litre: Number(rate.toFixed(2)),
        total_cost: Number((litres * rate).toFixed(2)),
        odometer: between(40000, 180000),
        bill_number: `FB${between(10000, 99999)}`,
        recorded_by: financialStaff[0].userId,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await insert('vehicle_maintenance', {
        campus_id: campusId,
        vehicle_id: vehicleId,
        service_date: daysAgo(between(20, 300)),
        service_type: pick(['Routine Service', 'Brake Replacement', 'Tyre Change', 'Engine Overhaul', 'AC Service']),
        description: 'Scheduled preventive maintenance',
        cost: between(2500, 28000),
        garage: pick(['Sri Basava Motors', 'Raichur Auto Works', 'Highway Service Centre']),
        next_service_date: daysAhead(between(30, 120)),
        recorded_by: financialStaff[0].userId,
      });
    }
  }
  console.log(`· transport: ${vehicles.length} vehicles, ${routes.length} routes, ${allocations} allocations`);

  // ---------------------------------------------------------------- fees
  const feeCategorySeed = [
    ['TUIT', 'Tuition Fee', 'ANNUAL', 1],
    ['ADM', 'Admission Fee', 'ONE_TIME', 0],
    ['EXAM', 'Examination Fee', 'TERM', 1],
    ['LAB', 'Laboratory Fee', 'ANNUAL', 1],
    ['LIB', 'Library Fee', 'ANNUAL', 1],
    ['TRAN', 'Transport Fee', 'ANNUAL', 1],
    ['SPRT', 'Sports & Activity Fee', 'ANNUAL', 1],
  ];
  const feeCategories = {};
  for (const [code, name, frequency, recurring] of feeCategorySeed) {
    feeCategories[code] = await insert('fee_categories', {
      campus_id: campusId, code, name, frequency, is_recurring: recurring,
    });
  }

  const feeStructures = [];
  for (const klass of classes) {
    // The CBSE wing carries a higher tuition, as it does in practice.
    // Senior secondary costs more to run than the middle school.
    const senior = klass.level >= SENIOR_LEVEL ? 12000 : 0;
    const base = (klass.board === 'CBSE' ? 26000 : 18000) + klass.level * 1800 + senior;
    const heads = [
      ['TUIT', `Tuition Fee — Class ${klass.level}`, base, daysAhead(30)],
      ['EXAM', `Examination Fee — Class ${klass.level}`, 2400, daysAhead(55)],
      ['LIB', `Library Fee — Class ${klass.level}`, 1200, daysAgo(20)],
      ['SPRT', `Sports & Activity Fee — Class ${klass.level}`, 1800, daysAgo(20)],
    ];
    if (klass.level >= 7) heads.push(['LAB', `Laboratory Fee — Class ${klass.level}`, 3600, daysAhead(30)]);

    for (const [category, name, amount, dueDate] of heads) {
      feeStructures.push({
        id: await insert('fee_structures', {
          campus_id: campusId,
          academic_year_id: year2025,
          class_id: klass.id,
          fee_category_id: feeCategories[category],
          name,
          amount,
          due_date: dueDate,
          late_fee_per_day: 10,
        }),
        classId: klass.id,
        amount,
        dueDate,
        name,
      });
    }
  }

  let receiptCounter = 1;
  let paymentCount = 0;
  for (const student of students) {
    const applicable = feeStructures.filter((f) => f.classId === student.classId);
    for (const structure of applicable) {
      // A few students have a concession.
      const discount = chance(0.08) ? Math.round(structure.amount * 0.25) : 0;
      const payable = structure.amount - discount;

      // 62% fully paid, 20% partially paid, the rest still pending.
      const roll = rnd();
      const paid = roll < 0.62 ? payable : roll < 0.82 ? Math.round(payable * (0.3 + rnd() * 0.4)) : 0;

      const studentFeeId = await insert('student_fees', {
        campus_id: campusId,
        student_id: student.id,
        fee_structure_id: structure.id,
        academic_year_id: year2025,
        total_amount: structure.amount,
        discount_amount: discount,
        concession_reason: discount ? pick(['Sibling concession', 'Staff ward', 'Merit scholarship']) : null,
        paid_amount: paid,
        due_date: structure.dueDate,
        status:
          paid >= payable ? 'PAID' : paid > 0 ? 'PARTIAL' : new Date(structure.dueDate) < new Date() ? 'OVERDUE' : 'PENDING',
      });

      if (paid > 0) {
        const paymentDate = daysAgo(between(1, 90));
        const mode = pick(['CASH', 'UPI', 'ONLINE', 'NEFT', 'CARD', 'CHEQUE']);
        const collector = pick(financialStaff);
        const paymentId = await insert('fee_payments', {
          campus_id: campusId,
          student_fee_id: studentFeeId,
          student_id: student.id,
          amount: paid,
          payment_date: paymentDate,
          payment_mode: mode,
          transaction_ref: mode === 'CASH' ? null : `TXN${between(100000000, 999999999)}`,
          bank_name: ['NEFT', 'CHEQUE'].includes(mode) ? pick(['SBI', 'HDFC Bank', 'ICICI Bank', 'Canara Bank']) : null,
          status: 'SUCCESS',
          collected_by: collector.userId,
        });
        const receiptNumber = `RCP/2025/${String(receiptCounter).padStart(5, '0')}`;
        await insert('fee_receipts', {
          campus_id: campusId,
          fee_payment_id: paymentId,
          student_id: student.id,
          receipt_number: receiptNumber,
          amount: paid,
          amount_in_words: amountInWords(paid),
          issued_by: collector.userId,
          issued_at: `${paymentDate} 10:${String(between(10, 59))}:00`,
        });
        await insert('income', {
          campus_id: campusId,
          category: 'FEES',
          title: `${structure.name} — ${student.admissionNumber}`,
          amount: paid,
          income_date: paymentDate,
          payment_mode: mode,
          reference: receiptNumber,
          recorded_by: collector.userId,
        });
        receiptCounter += 1;
        paymentCount += 1;
      }
    }
  }
  console.log(`· fees: ${feeStructures.length} structures, ${paymentCount} payments with receipts`);

  // ------------------------------------------------- other income/expenses
  const expenseSeed = [
    ['UTILITIES', 'Electricity Bill', 'APSPDCL'],
    ['UTILITIES', 'Water Charges', 'Raichur City Municipal Council'],
    ['MAINTENANCE', 'Building Repairs', 'Sri Sai Constructions'],
    ['SUPPLIES', 'Stationery Purchase', 'Raichur Stationers'],
    ['TRANSPORT', 'Diesel Top-up', 'Bharat Petroleum'],
    ['EVENTS', 'Annual Day Arrangements', 'Sri Krishna Events'],
    ['IT', 'Internet & Leased Line', 'BSNL'],
    ['HOUSEKEEPING', 'Housekeeping Contract', 'CleanServe Facilities'],
  ];
  for (let i = 0; i < 60; i += 1) {
    const [category, title, vendor] = pick(expenseSeed);
    await insert('expenses', {
      campus_id: campusId,
      category,
      title,
      amount: between(4000, 180000),
      expense_date: daysAgo(between(1, 300)),
      payment_mode: pick(['NEFT', 'CASH', 'ONLINE', 'CHEQUE']),
      vendor,
      bill_number: `BILL${between(10000, 99999)}`,
      status: 'APPROVED',
      recorded_by: financialStaff[between(0, financialStaff.length - 1)].userId,
      approved_by: adminUserId,
    });
  }
  for (let i = 0; i < 10; i += 1) {
    await insert('income', {
      campus_id: campusId,
      category: pick(['DONATION', 'RENT', 'MISCELLANEOUS', 'CANTEEN']),
      title: pick(['Alumni donation', 'Ground rental', 'Canteen share', 'Uniform sales']),
      amount: between(5000, 90000),
      income_date: daysAgo(between(5, 250)),
      payment_mode: pick(['NEFT', 'CASH', 'UPI']),
      recorded_by: financialStaff[0].userId,
    });
  }

  let pettyBalance = 0;
  for (let i = 0; i < 18; i += 1) {
    const type = chance(0.35) ? 'IN' : 'OUT';
    const amount = type === 'IN' ? between(5000, 20000) : between(200, 3500);
    pettyBalance += type === 'IN' ? amount : -amount;
    await insert('petty_cash', {
      campus_id: campusId,
      entry_date: daysAgo(between(1, 90)),
      entry_type: type,
      amount,
      purpose: type === 'IN' ? 'Cash replenishment from accounts' : pick(['Courier charges', 'Tea & refreshments', 'Local conveyance', 'Photocopy charges', 'Emergency stationery']),
      balance_after: pettyBalance,
      handled_by: financialStaff[1].userId,
    });
  }

  // ---------------------------------------------------------------- payroll
  const payScale = {
    'Senior Teacher': 42000, Teacher: 34000, 'Physical Director': 36000,
    'Accounts Manager': 46000, 'Fee Collection Officer': 30000, 'Accounts Assistant': 26000,
    'Chief Administrative Officer': 62000, 'Academic Administrator': 54000,
  };
  const payrollUsers = [
    ...await all(`SELECT f.user_id, f.designation, f.campus_id FROM faculty f`),
    ...await all(`SELECT a.user_id, a.designation, a.campus_id FROM administrators a`),
  ];
  for (const person of payrollUsers) {
    const basic = payScale[person.designation] || 30000;
    await insert('salary_structures', {
      campus_id: person.campus_id,
      user_id: person.user_id,
      basic_salary: basic,
      hra: Math.round(basic * 0.2),
      da: Math.round(basic * 0.12),
      conveyance: 2400,
      medical: 1600,
      other_allowances: 1000,
      pf_deduction: Math.round(basic * 0.12),
      tax_deduction: basic > 40000 ? Math.round(basic * 0.05) : 0,
      other_deductions: 200,
      effective_from: '2025-04-01',
    });
  }

  const now = new Date();
  for (let back = 0; back < 3; back += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const workingDays = new Date(year, month, 0).getDate();

    for (const person of payrollUsers) {
      const structure = await get(`SELECT * FROM salary_structures WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [person.user_id]);
      const allowances = structure.hra + structure.da + structure.conveyance + structure.medical + structure.other_allowances;
      const lop = chance(0.12) ? between(1, 2) : 0;
      const perDay = (structure.basic_salary + allowances) / workingDays;
      const deductions = structure.pf_deduction + structure.tax_deduction + structure.other_deductions + Math.round(perDay * lop);
      const gross = structure.basic_salary + allowances;

      await insert('payroll', {
        campus_id: person.campus_id,
        user_id: person.user_id,
        month,
        year,
        basic_salary: structure.basic_salary,
        total_allowances: allowances,
        total_deductions: deductions,
        working_days: workingDays,
        present_days: workingDays - lop,
        lop_days: lop,
        gross_salary: gross,
        net_salary: gross - deductions,
        payslip_number: `PS/${year}/${String(month).padStart(2, '0')}/${String(person.user_id).padStart(5, '0')}`,
        payment_date: back === 0 ? null : iso(new Date(year, month, 2)),
        payment_mode: 'NEFT',
        status: back === 0 ? 'PROCESSED' : 'PAID',
        processed_by: financialStaff[0].userId,
      });
    }
  }
  console.log(`· payroll: ${payrollUsers.length} salary structures, 3 months of payslips`);

  // ------------------------------------------------------- examinations
  const examSeed = [
    ['Unit Test I — 2025', 'UNIT_TEST', daysAgo(75), daysAgo(70), 'RESULTS_PUBLISHED', 25],
    ['Quarterly Examination 2025', 'TERM', daysAgo(45), daysAgo(38), 'RESULTS_PUBLISHED', 50],
    ['Half-Yearly Examination 2025', 'MID_TERM', daysAgo(12), daysAgo(5), 'COMPLETED', 100],
    ['Annual Examination 2026', 'FINAL', daysAhead(85), daysAhead(95), 'SCHEDULED', 100],
  ];

  const examinations = await seqMap(examSeed, async ([name, type, start, end, status, weightage]) =>
    await insert('examinations', {
      campus_id: campusId,
      academic_year_id: year2025,
      name,
      exam_type: type,
      start_date: start,
      end_date: end,
      description: `${name} for all classes`,
      weightage,
      status,
      created_by: administratorIds.length ? adminUserId : adminUserId,
    })
  );

  let marksCount = 0;
  await seqEach(examSeed, async ([, , startDate, , status], examIndex) => {
    const examinationId = examinations[examIndex];
    const isPublished = status === 'RESULTS_PUBLISHED';
    const isCompleted = status === 'COMPLETED';
    if (status === 'SCHEDULED') {
      // Future exam: schedule the papers but record no marks.
      await seqEach(courses, async (course, index) => {
        await insert('exam_subjects', {
          campus_id: campusId,
          examination_id: examinationId,
          course_id: course.id,
          class_id: course.classId,
          exam_date: daysAhead(85 + (index % 10)),
          start_time: '09:30',
          end_time: '12:30',
          room: `Exam Hall ${1 + (index % 4)}`,
          max_marks: course.subjectCode === 'PE' ? 50 : 100,
          pass_marks: course.subjectCode === 'PE' ? 18 : 35,
          invigilator_id: teachers[index % teachers.length].id,
        });
      });
      return;
    }

    await seqEach(courses, async (course, index) => {
      const maxMarks = course.subjectCode === 'PE' ? 50 : 100;
      const passMarks = course.subjectCode === 'PE' ? 18 : 35;
      const examSubjectId = await insert('exam_subjects', {
        campus_id: campusId,
        examination_id: examinationId,
        course_id: course.id,
        class_id: course.classId,
        exam_date: startDate,
        start_time: '09:30',
        end_time: '12:30',
        room: `Exam Hall ${1 + (index % 4)}`,
        max_marks: maxMarks,
        pass_marks: passMarks,
        invigilator_id: teachers[index % teachers.length].id,
      });

      const teacher = await get(
        `SELECT f.user_id, ca.faculty_id FROM course_assignments ca JOIN faculty f ON f.id = ca.faculty_id
          WHERE ca.course_id = ? LIMIT 1`,
        [course.id]
      );

      for (const student of students.filter((s) => s.classId === course.classId)) {
        const absent = chance(0.02);
        // A believable spread centred a little above the midpoint.
        const ratio = Math.min(0.99, Math.max(0.18, 0.62 + (rnd() - 0.5) * 0.55));
        const obtained = absent ? null : Math.round(maxMarks * ratio);
        const percentage = absent ? 0 : (obtained / maxMarks) * 100;
        const band = gradeBands.find((g) => percentage >= g[2] && percentage <= g[3]);

        // The Half-Yearly is the paper still moving through approval: most
        // subjects are approved, a few are still awaiting the administrator.
        const markStatus = isPublished ? 'APPROVED' : isCompleted ? (index % 7 === 0 ? 'SUBMITTED' : 'APPROVED') : 'DRAFT';

        await insert('marks', {
          campus_id: campusId,
          examination_id: examinationId,
          exam_subject_id: examSubjectId,
          student_id: student.id,
          course_id: course.id,
          marks_obtained: obtained,
          max_marks: maxMarks,
          grade: absent ? null : band?.[0] ?? null,
          is_absent: absent ? 1 : 0,
          status: markStatus,
          entered_by: teacher?.user_id ?? adminUserId,
          submitted_at: markStatus === 'DRAFT' ? null : `${startDate} 17:30:00`,
          approved_by: markStatus === 'APPROVED' ? adminUserId : null,
          approved_at: markStatus === 'APPROVED' ? `${startDate} 18:15:00` : null,
        });
        marksCount += 1;
      }
    });

    // Results for the two published examinations.
    if (isPublished) {
      for (const student of students) {
        const totals = await get(
          `SELECT SUM(COALESCE(marks_obtained,0)) AS obtained, SUM(max_marks) AS total,
                  SUM(CASE WHEN marks_obtained < 35 OR is_absent = 1 THEN 1 ELSE 0 END) AS failed
             FROM marks WHERE examination_id = ? AND student_id = ?`,
          [examinationId, student.id]
        );
        if (!totals?.total) continue;
        const percentage = Number(((totals.obtained / totals.total) * 100).toFixed(2));
        const band = gradeBands.find((g) => percentage >= g[2] && percentage <= g[3]);
        const attendance = await get(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present
             FROM attendance WHERE student_id = ?`,
          [student.id]
        );
        await insert('results', {
          campus_id: campusId,
          examination_id: examinationId,
          student_id: student.id,
          class_id: student.classId,
          section_id: student.sectionId,
          total_marks: totals.total,
          obtained_marks: totals.obtained,
          percentage,
          grade: band?.[0] ?? null,
          attendance_percent: attendance?.total
            ? Number(((attendance.present / attendance.total) * 100).toFixed(2))
            : null,
          // Same rule the API applies: 35% aggregate or above is a pass.
          result_status: percentage >= 35 ? 'PASS' : 'FAIL',
          remarks: band?.[5] ?? null,
          published: 1,
          published_by: adminUserId,
          published_at: `${startDate} 19:00:00`,
        });
      }

      // Class ranks.
      for (const klass of classes) {
        const ranked = await all(
          `SELECT id FROM results WHERE examination_id = ? AND class_id = ? ORDER BY obtained_marks DESC, percentage DESC`,
          [examinationId, klass.id]
        );
        await seqEach(ranked, async (result, position) => await run('UPDATE results SET rank_in_class = ? WHERE id = ?', [position + 1, result.id]));
      }
    }
  });
  console.log(`· examinations: ${examinations.length} exams, ${marksCount} mark entries, results published for 2`);

  // --------------------------------------------------- course materials
  const materialSeed = [
    ['Chapter Notes', 'NOTES'], ['Reference PDF', 'PDF'], ['Lecture Slides', 'PRESENTATION'],
    ['Recorded Session', 'VIDEO'], ['Practice Worksheet', 'ASSIGNMENT'], ['Reference Link', 'LINK'],
  ];
  let materialCount = 0;
  for (const course of courses) {
    if (!chance(0.55)) continue;
    const assignment = await get('SELECT faculty_id, section_id FROM course_assignments WHERE course_id = ? LIMIT 1', [course.id]);
    if (!assignment) continue;
    const count = between(1, 3);
    for (let i = 0; i < count; i += 1) {
      const [titlePrefix, type] = pick(materialSeed);
      const isLink = type === 'LINK' || type === 'VIDEO';
      // Everything that is not a link points at a real file, so the portal's
      // preview and download both do something.
      const file = isLink ? null : pick(MATERIAL_FILES);
      await insert('course_materials', {
        campus_id: campusId,
        course_id: course.id,
        section_id: assignment.section_id,
        faculty_id: assignment.faculty_id,
        title: `${titlePrefix} — Unit ${between(1, 8)}`,
        description: `${titlePrefix} prepared for Class ${course.level} ${course.subjectCode}.`,
        material_type: type,
        file_path: file?.path ?? null,
        file_name: file?.name ?? null,
        file_size: file?.size ?? null,
        external_url: isLink ? 'https://www.vignan.edu.in/resources' : null,
        due_date: type === 'ASSIGNMENT' ? daysAhead(between(3, 20)) : null,
        is_published: 1,
        created_at: `${daysAgo(between(1, 60))} 10:00:00`,
      });
      materialCount += 1;
    }
  }
  console.log(`· ${materialCount} course materials`);

  // ---------------------------------------------------------- mentoring
  const mentoringSeed = [
    ['GUIDANCE', 'Career guidance discussion', 'Discussed subject choices and long-term interests. Student is inclined towards engineering.'],
    ['MEETING', 'Monthly mentoring meeting', 'Reviewed academic progress and attendance. Advised structured revision plan.'],
    ['REMARK', 'Improvement in Mathematics', 'Marked improvement observed after remedial classes.'],
    ['CONCERN', 'Attendance concern', 'Attendance dropped below the expected level. Parents informed.'],
    ['ACHIEVEMENT', 'District-level quiz winner', 'Represented the school and secured first place.'],
  ];
  let mentoringCount = 0;
  for (const student of students) {
    if (!chance(0.4)) continue;
    const mentorId = student.mentorId ?? (await get('SELECT mentor_id FROM students WHERE id = ?', [student.id])).mentor_id;
    if (!mentorId) continue;
    const mentor = await get('SELECT user_id FROM faculty WHERE id = ?', [mentorId]);
    const count = between(1, 3);
    for (let i = 0; i < count; i += 1) {
      const [type, title, notes] = pick(mentoringSeed);
      await insert('mentoring_records', {
        campus_id: campusId,
        student_id: student.id,
        mentor_id: mentorId,
        record_type: type,
        title,
        notes,
        meeting_date: daysAgo(between(2, 90)),
        action_items: pick(['Weekly revision plan', 'Attend remedial class', 'Parent meeting scheduled', 'Continue current approach']),
        follow_up_date: daysAhead(between(7, 45)),
        visible_to_parent: chance(0.85) ? 1 : 0,
        created_by: mentor?.user_id ?? adminUserId,
        created_at: `${daysAgo(between(2, 90))} 15:20:00`,
      });
      mentoringCount += 1;
    }
  }
  console.log(`· ${mentoringCount} mentoring records`);

  // ------------------------------------------------------ leave requests
  const studentLeaveReasons = [
    'Fever and cold, advised rest by the doctor.',
    'Family function out of station.',
    'Medical check-up at Raichur Institute of Medical Sciences.',
    'Attending a cousin\'s wedding.',
    'Viral fever — medical certificate attached.',
  ];
  for (let i = 0; i < 30; i += 1) {
    const student = pick(students);
    const parent = parents.find((p) => p.children.some((c) => c.id === student.id));
    const from = daysAgo(between(1, 40));
    const to = iso(new Date(new Date(from).getTime() + between(0, 2) * 86400000));
    const status = pick(['PENDING', 'APPROVED', 'APPROVED', 'REJECTED']);
    await insert('leave_requests', {
      campus_id: campusId,
      requester_type: 'STUDENT',
      student_id: student.id,
      raised_by: parent?.userId ?? student.userId,
      leave_type: pick(['SICK', 'CASUAL', 'EMERGENCY']),
      from_date: from,
      to_date: to,
      days: Math.max(1, (new Date(to) - new Date(from)) / 86400000 + 1),
      reason: pick(studentLeaveReasons),
      status,
      reviewed_by: status === 'PENDING' ? null : adminUserId,
      reviewed_at: status === 'PENDING' ? null : `${to} 09:30:00`,
      review_remarks: status === 'REJECTED' ? 'Insufficient supporting documentation.' : status === 'APPROVED' ? 'Approved.' : null,
    });
  }
  for (let i = 0; i < 12; i += 1) {
    const staff = pick(allStaff);
    const from = daysAgo(between(1, 50));
    await insert('leave_requests', {
      campus_id: campusId,
      requester_type: 'FACULTY',
      faculty_id: staff.id,
      raised_by: staff.userId,
      leave_type: pick(['CASUAL', 'SICK', 'EARNED']),
      from_date: from,
      to_date: iso(new Date(new Date(from).getTime() + between(0, 2) * 86400000)),
      days: between(1, 3),
      reason: pick(['Personal work', 'Medical treatment', 'Family emergency', 'Attending a workshop']),
      status: pick(['PENDING', 'APPROVED', 'APPROVED']),
      reviewed_by: adminUserId,
    });
  }

  // ----------------------------------------------------- communications
  const announcementSeed = [
    ['Annual Day Celebrations — 12 September', 'The Annual Day of Vignan Vidyalayam will be celebrated on 12 September in the main auditorium. All students must report by 4:00 PM in full school uniform. Parents are cordially invited.', 'HIGH', 'ALL', 1],
    ['Half-Yearly Examination Results Published', 'Results for the Half-Yearly Examination are now available in the student and parent portals. Please review the subject-wise performance and contact the class teacher for any clarification.', 'NORMAL', 'ALL', 1],
    ['Parent-Teacher Meeting — Classes 6 to 10', 'A Parent-Teacher Meeting is scheduled for Saturday. Slots are allotted class-wise between 9:00 AM and 1:00 PM.', 'HIGH', 'PARENTS', 1],
    ['Revised Transport Timings from Monday', 'Owing to road work on the Sindhanur route, morning pickup timings on Route R02 are advanced by 15 minutes with effect from Monday.', 'URGENT', 'ALL', 1],
    ['Staff Development Workshop', 'A two-day pedagogy workshop for all teaching staff will be conducted in the seminar hall. Attendance is mandatory.', 'NORMAL', 'TEACHING_STAFF', 0],
    ['Quarterly Fee Reminder', 'Parents are requested to clear outstanding quarterly fees before the due date to avoid late charges.', 'NORMAL', 'PARENTS', 0],
    ['Science Exhibition — Registrations Open', 'Students of Classes 7 to 10 may register for the inter-school Science Exhibition with their science teachers.', 'NORMAL', 'STUDENTS', 1],
  ];
  await seqEach(announcementSeed, async ([title, content, priority, target, website], index) => {
    await insert('announcements', {
      campus_id: campusId,
      title,
      content,
      category: 'GENERAL',
      priority,
      target_type: target,
      publish_date: daysAgo(index * 3 + 1),
      expiry_date: daysAhead(30),
      is_published: 1,
      created_by: adminUserId,
      created_at: `${daysAgo(index * 3 + 1)} 09:00:00`,
    });
  });

  const noticeSeed = [
    ['VGN/2025/N-014', 'Holiday Notice — Vinayaka Chaturthi', 'The school will remain closed on account of Vinayaka Chaturthi. Regular classes resume the following working day.', 'ALL', 1],
    ['VGN/2025/N-015', 'Uniform Policy Reminder', 'All students must attend school in the prescribed uniform. Sports uniform is permitted only on designated days.', 'STUDENTS', 0],
    ['VGN/2025/N-016', 'Library Book Return — End of Term', 'All borrowed library books must be returned before the end of the term. Overdue fines apply at INR 2 per day.', 'ALL', 0],
    ['VGN/2025/N-017', 'Bus Fee Collection Schedule', 'Transport fees for the second instalment will be collected at the accounts counter between 9:30 AM and 3:00 PM.', 'PARENTS', 1],
  ];
  await seqEach(noticeSeed, async ([number, title, content, target, website], index) => {
    await insert('notices', {
      campus_id: campusId,
      notice_number: number,
      title,
      content,
      target_type: target,
      notice_date: daysAgo(index * 4 + 2),
      expiry_date: daysAhead(45),
      is_published: 1,
      created_by: adminUserId,
    });
  });

  const circularSeed = [
    ['VGN/CIR/2025/08', 'Revised Academic Calendar for Term II', 'The academic calendar for Term II has been revised. Working Saturdays and examination windows are listed in the attachment.', 'ALL'],
    ['VGN/CIR/2025/09', 'Safety Drill Procedure', 'A fire and earthquake safety drill will be conducted. Class teachers must brief students on assembly points.', 'ALL'],
    ['VGN/CIR/2025/10', 'Marks Submission Deadline', 'All teaching staff must submit half-yearly marks for approval before the stated deadline.', 'TEACHING_STAFF'],
  ];
  await seqEach(circularSeed, async ([number, title, content, target], index) => {
    await insert('circulars', {
      campus_id: campusId,
      circular_number: number,
      title,
      content,
      target_type: target,
      issue_date: daysAgo(index * 6 + 3),
      is_published: 1,
      created_by: adminUserId,
    });
  });

  const eventSeed = [
    ['Annual Day 2025', 'Cultural performances by students of all classes.', 'CULTURAL', daysAhead(17), '16:00', 'Main Auditorium', 1],
    ['Inter-House Sports Meet', 'Track and field events across all four houses.', 'SPORTS', daysAhead(28), '08:00', 'School Grounds', 1],
    ['Parent-Teacher Meeting', 'Class-wise slots for Classes 6 to 10.', 'PTM', daysAhead(6), '09:00', 'Respective Classrooms', 0],
    ['Vinayaka Chaturthi', 'School holiday.', 'HOLIDAY', daysAhead(12), null, null, 1],
    ['Dussehra Vacation Begins', 'School closed for Dussehra vacation.', 'HOLIDAY', daysAhead(40), null, null, 1],
    ['Science Exhibition', 'Inter-school science exhibition and model display.', 'EVENT', daysAhead(34), '09:30', 'Science Block', 1],
    ['Half-Yearly Examinations', 'Half-yearly examination window for all classes.', 'EXAM', daysAgo(12), '09:30', 'Exam Halls', 0],
    ['Independence Day Celebration', 'Flag hoisting and cultural programme.', 'EVENT', daysAgo(11), '08:00', 'School Grounds', 1],
  ];
  await seqEach(eventSeed, async ([title, description, type, startDate, startTime, venue, website]) => {
    await insert('events', {
      campus_id: campusId,
      title,
      description,
      event_type: type,
      start_date: startDate,
      start_time: startTime,
      venue,
      target_type: 'ALL',
      is_published: 1,
      created_by: adminUserId,
    });
  });
  console.log('· announcements, notices, circulars and events');

  // ------------------------------------------------------------ messages
  const messageSeed = [
    ['Regarding my ward\'s Mathematics performance', 'Respected Sir, my son has been finding the recent Mathematics chapters difficult. Could you kindly advise on additional practice material? Thank you.'],
    ['Request for leave — medical', 'Madam, my daughter is unwell with viral fever. Kindly grant leave for two days. The medical certificate is attached in the leave request.'],
    ['Transport pickup point change', 'Sir, we have shifted residence within Brodipet. Could the pickup point be updated for the coming week?'],
    ['Query on the fee receipt', 'Sir, I paid the quarterly fee last week but would like a duplicate receipt for reimbursement. Kindly advise.'],
  ];
  await seqEach(messageSeed, async ([subject, body], index) => {
    const parent = parents[index * 7 % parents.length];
    const recipient = index % 2 === 0 ? teachers[index % teachers.length].userId : financialStaff[0].userId;
    const messageId = await insert('messages', {
      campus_id: campusId,
      sender_id: parent.userId,
      recipient_id: recipient,
      subject,
      body,
      context_student_id: parent.children[0].id,
      is_read: index < 2 ? 1 : 0,
      created_at: `${daysAgo(between(1, 12))} 11:${String(between(10, 59))}:00`,
    });
    if (index < 2) {
      await insert('messages', {
        campus_id: campusId,
        sender_id: recipient,
        recipient_id: parent.userId,
        parent_message_id: messageId,
        subject: `Re: ${subject}`,
        body: 'Thank you for writing in. I have noted your request and will follow up with the concerned department. Regards.',
        context_student_id: parent.children[0].id,
        created_at: `${daysAgo(between(1, 10))} 15:20:00`,
      });
    }
  });

  // ------------------------------------------------------------- notifications
  const notificationSeed = [
    ['ANNOUNCEMENT', 'Annual Day Celebrations — 12 September', 'All students must report by 4:00 PM in full school uniform.', '/announcements'],
    ['RESULT_PUBLISHED', 'Quarterly Examination results published', 'Your result is now available.', '/results'],
    ['FEE_DUE', 'Fee instalment due shortly', 'The next fee instalment falls due within 30 days.', '/fees'],
    ['NEW_MATERIAL', 'New course material uploaded', 'Fresh notes have been added to one of your courses.', '/materials'],
    ['TIMETABLE_UPDATED', 'Timetable updated', 'Your class timetable has been revised.', '/timetable'],
  ];
  const notificationTargets = [
    adminUserId,
    ...await seqMap(administratorIds, async (id) => (await get('SELECT user_id FROM administrators WHERE id = ?', [id])).user_id),
    ...teachers.slice(0, 6).map((t) => t.userId),
    ...financialStaff.map((f) => f.userId),
    ...students.slice(0, 40).map((s) => s.userId),
    ...parents.slice(0, 30).map((p) => p.userId),
  ];
  for (const userId of notificationTargets) {
    const count = between(2, 5);
    for (let i = 0; i < count; i += 1) {
      const [type, title, body, link] = pick(notificationSeed);
      await insert('notifications', {
        campus_id: campusId,
        user_id: userId,
        type,
        title,
        body,
        link,
        is_read: chance(0.45) ? 1 : 0,
        created_at: `${daysAgo(between(0, 20))} ${String(between(8, 19)).padStart(2, '0')}:${String(between(10, 59))}:00`,
      });
    }
  }

  // -------------------------------------------------------- audit trail
  const auditSeed = [
    ['LOGIN', 'auth', 'Signed in', adminUserId, 'Dr. Rajesh Kumar Vignan', 'ADMIN'],
    ['PERMISSION_CHANGE', 'administrators', 'Changed Administrator Permission for Mallikarjun Swamy', adminUserId, 'Dr. Rajesh Kumar Vignan', 'ADMIN'],
    ['CREATE', 'students', 'Admitted 12 students into Class 1', administratorIds.length ? adminUserId : adminUserId, 'Shobha Deshpande', 'ADMINISTRATOR'],
    ['PUBLISH', 'results', 'Published results for Quarterly Examination 2025', adminUserId, 'Dr. Rajesh Kumar Vignan', 'ADMIN'],
    ['MARKS_UPDATE', 'marks', 'Submitted 28 mark entries for approval', teachers[0].userId, teachers[0].name, 'TEACHING_STAFF'],
    ['APPROVE', 'marks', 'Approved 28 mark entries', adminUserId, 'Shobha Deshpande', 'ADMINISTRATOR'],
    ['FEE_PAYMENT', 'payments', 'Collected 24600 from VGN2025-0031', financialStaff[0].userId, financialStaff[0].name, 'FINANCIAL_STAFF'],
    ['ATTENDANCE_UPDATE', 'attendance', 'Marked attendance for Class 8A', teachers[1].userId, teachers[1].name, 'TEACHING_STAFF'],
    ['SYSTEM_CHANGE', 'settings', 'Updated 3 system setting(s)', adminUserId, 'Dr. Rajesh Kumar Vignan', 'ADMIN'],
    ['EXPORT', 'reports', 'Generated Fee Collection Report (XLSX, 412 rows)', financialStaff[0].userId, financialStaff[0].name, 'FINANCIAL_STAFF'],
  ];
  await seqEach(auditSeed, async ([action, moduleName, description, userId, userName, roleCode], index) => {
    await insert('activity_logs', {
      campus_id: campusId,
      user_id: userId,
      user_name: userName,
      role_code: roleCode,
      action,
      module: moduleName,
      description,
      ip_address: `10.0.${between(1, 20)}.${between(2, 250)}`,
      status: 'SUCCESS',
      created_at: `${daysAgo(index)} ${String(between(9, 18)).padStart(2, '0')}:${String(between(10, 59))}:00`,
    });
  });

  return {
    campusId,
    students: students.length,
    parents: parents.length,
    multiChild,
    teachers,
    financialStaff,
    // The account the credentials table names. Prefer a family of three, and
    // among those one spanning both departments — it shows child switching and
    // the State/CBSE split at once.
    exampleParent:
      threeChild.find((parent) => new Set(parent.children.map((c) => c.board)).size > 1) ??
      threeChild[0] ??
      multiChild.find((parent) => new Set(parent.children.map((c) => c.board)).size > 1) ??
      multiChild[0],
  };
});

const summary = await seedAll();

// ---------------------------------------------------------------- report
const counts = {};
for (const table of ['users', 'students', 'parents', 'faculty', 'administrators', 'courses', 'attendance', 'marks', 'results', 'fee_payments', 'notifications']) {
  counts[table] = Number(await scalar(`SELECT COUNT(*) AS n FROM ${table}`));
}

console.log('\nSeed complete.\n');
console.table(counts);

const exampleParent = summary.exampleParent
  ? await get('SELECT username FROM users WHERE id = ?', [summary.exampleParent.userId])
  : null;
const exampleStudent = await get(
  `SELECT u.username FROM students s JOIN users u ON u.id = s.user_id ORDER BY s.id LIMIT 1`
);

console.log(`Sign-in accounts (password for every demo account: ${PASSWORD})\n`);
console.table([
  { Role: 'ADMIN', Username: 'admin', Portal: '/admin/dashboard' },
  { Role: 'ADMINISTRATOR', Username: 'shobha', Portal: '/administrator/dashboard' },
  { Role: 'ADMINISTRATOR (restricted)', Username: 'mallikarjun', Portal: '/administrator/dashboard' },
  { Role: 'TEACHING_STAFF', Username: 'basavaraj', Portal: '/faculty/teaching/dashboard' },
  { Role: 'TEACHING_STAFF', Username: 'sunanda', Portal: '/faculty/teaching/dashboard' },
  { Role: 'FINANCIAL_STAFF', Username: 'gurunath', Portal: '/faculty/financial/dashboard' },
  // Pupils do not sign in; their records are reached through their parent.
  { Role: 'STUDENT', Username: '(no sign-in — use the parent account)', Portal: '—' },
  {
    Role: `PARENT (${summary.exampleParent?.children.length ?? 1} children)`,
    Username: exampleParent?.username ?? 'pvgn20250001',
    Portal: '/parent/dashboard',
  },
]);

if (summary.exampleParent) {
  console.log(
    `\nMulti-child parent "${exampleParent.username}" is linked to: ` +
      summary.exampleParent.children.map((c) => `${c.firstName} ${c.surname} (Class ${c.label} ${c.board})`).join(', ')
  );
}
console.log(`\n${summary.multiChild.length} parent accounts have more than one child.\n`);
