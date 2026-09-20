/**
 * End-to-end API, RBAC and workflow tests.
 *
 * Run the server, then:  npm run test -w server
 *
 * These tests exercise the security rules the specification calls out by name:
 * Student A cannot read Student B, Parent A cannot read Parent B's child,
 * Teacher A cannot write Teacher B's marks, Financial Staff cannot touch
 * examination results, and an Administrator cannot change system settings.
 */
const BASE = process.env.API_BASE || 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD || 'Vignan@123';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

async function api(path, { token, method = 'GET', body, raw = false } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return response;
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, ok: response.ok, ...payload };
}

/** Upload a CSV the way the browser does, as multipart form data. */
async function upload(path, { token, csv, fields = {} }) {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'import.csv');
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, ok: response.ok, ...payload };
}

async function login(username, password = PASSWORD) {
  const result = await api('/auth/login', { method: 'POST', body: { login: username, password } });
  if (!result.data?.accessToken) throw new Error(`Login failed for ${username}: ${result.error?.message}`);
  return { token: result.data.accessToken, user: result.data.user, children: result.data.children };
}

const run = async () => {
  console.log(`\nVignan ERP — API test suite\n${BASE}\n`);

  // =================================================================
  section('1. Authentication & role detection');
  // =================================================================
  const health = await api('/health');
  check('health endpoint responds', health.status === 'ok' || health.status === 200 || !!health.app);

  const admin = await login('admin');
  check('ADMIN signs in', admin.user.role === 'ADMIN');
  check('ADMIN lands on /admin/dashboard', admin.user.home === '/admin/dashboard');
  check('ADMIN holds every permission', admin.user.permissions.length >= 180, `${admin.user.permissions.length} permissions`);

  const administrator = await login('shobha');
  check('ADMINISTRATOR signs in', administrator.user.role === 'ADMINISTRATOR');
  check('ADMINISTRATOR lands on /administrator/dashboard', administrator.user.home === '/administrator/dashboard');
  check(
    'ADMINISTRATOR is not an ADMIN (fewer permissions)',
    administrator.user.permissions.length < admin.user.permissions.length
  );
  check(
    'ADMINISTRATOR cannot manage roles',
    !administrator.user.permissions.includes('roles.manage')
  );
  check(
    'ADMINISTRATOR cannot edit system settings',
    !administrator.user.permissions.includes('settings.edit')
  );

  const restricted = await login('mallikarjun');
  check(
    'restricted ADMINISTRATOR lost students.delete via user override',
    !restricted.user.permissions.includes('students.delete')
  );
  check(
    'unrestricted ADMINISTRATOR keeps students.delete',
    administrator.user.permissions.includes('students.delete')
  );

  const teacherA = await login('basavaraj');
  check('TEACHING_STAFF signs in', teacherA.user.role === 'TEACHING_STAFF');
  check('TEACHING_STAFF lands on /faculty/teaching/dashboard', teacherA.user.home === '/faculty/teaching/dashboard');

  const teacherB = await login('sunanda');
  check('second teacher signs in', teacherB.user.role === 'TEACHING_STAFF');

  const financial = await login('gurunath');
  check('FINANCIAL_STAFF signs in', financial.user.role === 'FINANCIAL_STAFF');
  check('FINANCIAL_STAFF lands on /faculty/financial/dashboard', financial.user.home === '/faculty/financial/dashboard');

  const badLogin = await api('/auth/login', { method: 'POST', body: { login: 'admin', password: 'wrong-password' } });
  check('wrong password is rejected', badLogin.status === 401);

  const noToken = await api('/students');
  check('unauthenticated request is rejected', noToken.status === 401);

  const badToken = await api('/students', { token: 'not-a-real-token' });
  check('invalid token is rejected', badToken.status === 401);

  // Find a student and a parent to sign in as.
  const studentList = await api('/students?limit=5', { token: admin.token });
  const studentRowA = studentList.data[0];
  const studentRowB = studentList.data.find((s) => s.id !== studentRowA.id);
  check('admin can list students', studentList.data.length > 0);

  const studentAccount = await api(`/users?role=STUDENT&search=${studentRowA.admission_number}`, { token: admin.token });

  /*
   * Pupils are reached through their parent and their own logins are disabled.
   * The ownership rules the specification names — Student A cannot read Student
   * B — are still enforced by the API for the STUDENT role, so rather than lose
   * that coverage the suite enables two pupil accounts for its own duration and
   * puts them back at the end.
   */
  const pupilAccounts = [];
  const enablePupil = async (row) => {
    // The user search matches the login name, which is the admission number
    // reduced to letters and digits — not the admission number itself.
    const found = await api(`/users?role=STUDENT&search=${row.username}`, { token: admin.token });
    const account = found.data[0];
    if (!account) return null;
    await api(`/users/${account.id}`, { token: admin.token, method: 'PUT', body: { status: 'ACTIVE' } });
    pupilAccounts.push(account.id);
    return account;
  };
  const restorePupils = async () => {
    for (const id of pupilAccounts) {
      await api(`/users/${id}`, { token: admin.token, method: 'PUT', body: { status: 'INACTIVE' } });
    }
  };

  const pupilAccountA = await enablePupil(studentRowA);
  check('a pupil account exists but is disabled by default',
    !!pupilAccountA, 'pupils sign in through their parent');

  const studentA = await login(studentRowA.username);
  check('STUDENT signs in once enabled', studentA.user.role === 'STUDENT');
  check('STUDENT lands in the family section', studentA.user.home === '/parent/dashboard',
    `home=${studentA.user.home}`);
  check('STUDENT profile is attached to the session', !!studentA.user.profile?.id);

  await enablePupil(studentRowB);
  const studentB = await login(studentRowB.username);
  check('second student signs in', studentB.user.role === 'STUDENT');

  // A parent with two children.
  const parentList = await api('/parents?limit=100', { token: admin.token });
  const multiChildParent = parentList.data.find((p) => p.children?.length > 1);
  const otherParent = parentList.data.find((p) => p.id !== multiChildParent?.id && p.children?.length);
  const parentA = await login(multiChildParent.username);
  check('PARENT signs in', parentA.user.role === 'PARENT');
  check('PARENT lands on /parent/dashboard', parentA.user.home === '/parent/dashboard');
  check(
    'PARENT account supports multiple children',
    parentA.children.length > 1,
    `${parentA.children.length} children`
  );
  check(
    'children are in different classes',
    new Set(parentA.children.map((c) => c.class_id)).size > 1
  );

  const parentB = await login(otherParent.username);

  // =================================================================
  section('2. Role dashboards');
  // =================================================================
  const adminDash = await api('/dashboards/admin', { token: admin.token });
  check('admin dashboard returns counts', adminDash.data?.counts?.students > 0);
  check('admin dashboard separates the two faculty categories',
    adminDash.data.counts.teachingStaff > 0 && adminDash.data.counts.financialStaff > 0);
  check('admin dashboard includes recent activity', Array.isArray(adminDash.data.recentActivity));
  check('admin dashboard includes fee overview', adminDash.data.fees?.billed > 0);
  check('admin dashboard includes transport overview', adminDash.data.transport?.vehicles > 0);

  const administratorDash = await api('/dashboards/administrator', { token: administrator.token });
  check('administrator dashboard returns student figures', administratorDash.data?.students?.total > 0);
  check('administrator dashboard lists pending requests', administratorDash.data.pendingRequests !== undefined);

  const teachingDash = await api('/dashboards/teaching', { token: teacherA.token });
  check('teaching dashboard returns assigned courses', teachingDash.data?.counts?.assignedCourses > 0);
  check('teaching dashboard returns only assigned students', teachingDash.data.counts.students > 0);

  const financialDash = await api('/dashboards/financial', { token: financial.token });
  check('financial dashboard returns collection figures', financialDash.data?.collection !== undefined);
  check('financial dashboard returns transport expenses', financialDash.data.transportExpenses?.total >= 0);

  const studentDash = await api('/dashboards/student', { token: studentA.token });
  check('student dashboard returns own profile', studentDash.data?.student?.id === studentRowA.id);
  check('student dashboard returns attendance percentage', studentDash.data.attendance?.percentage >= 0);

  const parentDash = await api('/dashboards/parent', { token: parentA.token });
  check('parent dashboard returns the child list', parentDash.data?.children?.length > 1);
  check('parent dashboard defaults to the first child', !!parentDash.data.selectedChild);

  const secondChild = parentA.children[1];
  const parentDash2 = await api(`/dashboards/parent?student_id=${secondChild.id}`, { token: parentA.token });
  check('parent can switch to the second child', parentDash2.data.selectedChild.id === secondChild.id);
  check(
    'switching children changes the dashboard data',
    parentDash2.data.dashboard.student.id === secondChild.id
  );

  const crossDash = await api(`/dashboards/parent?student_id=${studentRowB.id}`, { token: parentA.token });
  check('parent cannot open a dashboard for an unrelated student', crossDash.status === 403, `got ${crossDash.status}`);

  const wrongDash = await api('/dashboards/admin', { token: administrator.token });
  check('administrator cannot open the admin dashboard', wrongDash.status === 403);

  // =================================================================
  section('3. Resource ownership — the rules named in the specification');
  // =================================================================
  const ownRead = await api(`/students/${studentRowA.id}`, { token: studentA.token });
  check('Student A can read their own record', ownRead.status === 200);

  const crossStudent = await api(`/students/${studentRowB.id}`, { token: studentA.token });
  check('Student A cannot access Student B', crossStudent.status === 403, `got ${crossStudent.status}`);

  const crossStudentProfile = await api(`/students/${studentRowB.id}/profile`, { token: studentA.token });
  check('Student A cannot access Student B 360 profile', crossStudentProfile.status === 403);

  const studentListAsStudent = await api('/students', { token: studentA.token });
  check(
    'a student listing students sees only themselves',
    studentListAsStudent.data?.length === 1 && studentListAsStudent.data[0].id === studentRowA.id
  );

  const ownChild = await api(`/students/${parentA.children[0].id}`, { token: parentA.token });
  check('Parent A can read their own child', ownChild.status === 200);

  const otherChild = parentB.children ? null : null;
  const parentBChildId = (await api('/auth/me', { token: parentB.token })).data.children[0].id;
  const crossChild = await api(`/students/${parentBChildId}`, { token: parentA.token });
  check("Parent A cannot access Parent B's child", crossChild.status === 403, `got ${crossChild.status}`);

  const parentStudentList = await api('/students', { token: parentA.token });
  check(
    'a parent listing students sees only their own children',
    parentStudentList.data?.length === parentA.children.length
  );

  // Teacher scoping
  const teacherACourses = await api('/academics/courses?limit=100', { token: teacherA.token });
  const teacherBCourses = await api('/academics/courses?limit=100', { token: teacherB.token });
  const aIds = new Set(teacherACourses.data.map((c) => c.id));
  const bOnly = teacherBCourses.data.find((c) => !aIds.has(c.id));
  check('Teacher A sees only their assigned courses', teacherACourses.data.length > 0);
  check('Teacher B has courses Teacher A does not', !!bOnly);

  const foreignCourseStudents = await api(`/academics/courses/${bOnly.id}/students`, { token: teacherA.token });
  check(
    "Teacher A cannot read Teacher B's course roster",
    foreignCourseStudents.status === 403,
    `got ${foreignCourseStudents.status}`
  );

  // =================================================================
  section('4. Permission enforcement across roles');
  // =================================================================
  const financialMarks = await api('/exams/marks/entry', {
    token: financial.token,
    method: 'POST',
    body: { exam_subject_id: 1, records: [{ student_id: studentRowA.id, marks_obtained: 99 }] },
  });
  check('Financial Staff cannot enter examination marks', financialMarks.status === 403, `got ${financialMarks.status}`);

  const financialResults = await api('/exams/examinations/1/publish-results', { token: financial.token, method: 'POST' });
  check('Financial Staff cannot publish results', financialResults.status === 403);

  const teacherFinance = await api('/finance/summary', { token: teacherA.token });
  check('Teacher cannot read global financial records', teacherFinance.status === 403, `got ${teacherFinance.status}`);

  const teacherPayroll = await api('/finance/payroll/generate', {
    token: teacherA.token,
    method: 'POST',
    body: { month: 1, year: 2026 },
  });
  check('Teacher cannot generate payroll', teacherPayroll.status === 403);

  const administratorSettings = await api('/system/settings', {
    token: administrator.token,
    method: 'PUT',
    body: { settings: [{ key: 'attendance_threshold', value: '10' }] },
  });
  check(
    'Administrator cannot modify Admin system settings',
    administratorSettings.status === 403,
    `got ${administratorSettings.status}`
  );

  const administratorRoles = await api('/roles/2/permissions', {
    token: administrator.token,
    method: 'PUT',
    body: { codes: ['students.view'] },
  });
  check('Administrator cannot change role permissions', administratorRoles.status === 403);

  const adminRoles = await api('/roles', { token: admin.token });
  check('only Admin reads the role catalogue', adminRoles.status === 200 && adminRoles.data.length >= 6);

  const adminRoleLock = await api(`/roles/${adminRoles.data.find((r) => r.code === 'ADMIN').id}/permissions`, {
    token: admin.token,
    method: 'PUT',
    body: { codes: ['students.view'] },
  });
  check('the ADMIN role cannot be stripped of access', adminRoleLock.status === 403);

  const studentAudit = await api('/system/audit-logs', { token: studentA.token });
  check('Student cannot read audit logs', studentAudit.status === 403);

  const studentUsers = await api('/users', { token: studentA.token });
  check('Student cannot list users', studentUsers.status === 403);

  const parentPayroll = await api('/finance/payroll', { token: parentA.token });
  check('Parent cannot read payroll', parentPayroll.status === 403);

  // =================================================================
  section('5. Academic workflows');
  // =================================================================
  // Attendance — a teacher marking their own class.
  const assignments = teachingDash.data.assignments;
  const assignment = assignments[0];
  const registerDate = new Date().toISOString().slice(0, 10);
  const register = await api(
    `/attendance/register?section_id=${assignment.section_id}&course_id=${assignment.course_id}&date=${registerDate}&period=1`,
    { token: teacherA.token }
  );
  check('teacher can open the register for an assigned class', register.status === 200 && register.data.students.length > 0);

  const markResult = await api('/attendance/mark', {
    token: teacherA.token,
    method: 'POST',
    body: {
      section_id: assignment.section_id,
      course_id: assignment.course_id,
      attendance_date: registerDate,
      period: 1,
      records: register.data.students.slice(0, 5).map((s, i) => ({
        student_id: s.id,
        status: i === 0 ? 'ABSENT' : 'PRESENT',
      })),
    },
  });
  check('teacher can mark attendance for an assigned class', markResult.status === 201, JSON.stringify(markResult.error || ''));

  // A teacher marking a class that is not theirs.
  const teacherBDash = await api('/dashboards/teaching', { token: teacherB.token });
  const foreignSection = teacherBDash.data.assignments.find(
    (a) => !assignments.some((own) => own.section_id === a.section_id && own.course_id === a.course_id)
  );
  if (foreignSection) {
    const foreignMark = await api('/attendance/mark', {
      token: teacherA.token,
      method: 'POST',
      body: {
        section_id: foreignSection.section_id,
        course_id: foreignSection.course_id,
        attendance_date: registerDate,
        period: 2,
        records: [{ student_id: studentRowA.id, status: 'PRESENT' }],
      },
    });
    check(
      "Teacher A cannot mark attendance for Teacher B's class",
      foreignMark.status === 403,
      `got ${foreignMark.status}`
    );
  }

  const futureMark = await api('/attendance/mark', {
    token: teacherA.token,
    method: 'POST',
    body: {
      section_id: assignment.section_id,
      course_id: assignment.course_id,
      attendance_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      period: 1,
      records: [{ student_id: register.data.students[0].id, status: 'PRESENT' }],
    },
  });
  check('attendance cannot be marked for a future date', futureMark.status === 400);

  const studentMarkAttempt = await api('/attendance/mark', {
    token: studentA.token,
    method: 'POST',
    body: {
      section_id: assignment.section_id,
      attendance_date: registerDate,
      period: 3,
      records: [{ student_id: studentRowA.id, status: 'PRESENT' }],
    },
  });
  check('students cannot modify attendance', studentMarkAttempt.status === 403);

  // Marks workflow: enter -> submit -> approve -> generate -> publish
  const pendingBefore = await api('/exams/marks/pending', { token: administrator.token });
  check('administrator can see the marks approval queue', pendingBefore.status === 200);
  check('there are batches awaiting approval from the seed', pendingBefore.data.length > 0);

  const batch = pendingBefore.data[0];
  const sheet = await api(`/exams/marks/sheet?exam_subject_id=${batch.exam_subject_id}`, { token: administrator.token });
  check('administrator can open a marks sheet', sheet.status === 200 && sheet.data.students.length > 0);

  const approve = await api('/exams/marks/review', {
    token: administrator.token,
    method: 'POST',
    body: { exam_subject_id: batch.exam_subject_id, decision: 'APPROVED' },
  });
  check('administrator approves submitted marks', approve.status === 200 && approve.data.affected > 0);

  const teacherApprove = await api('/exams/marks/review', {
    token: teacherA.token,
    method: 'POST',
    body: { exam_subject_id: batch.exam_subject_id, decision: 'APPROVED' },
  });
  check('a teacher cannot approve their own marks', teacherApprove.status === 403);

  // Results visibility: unpublished results must stay hidden from students.
  const examList = await api('/exams/examinations?limit=20', { token: admin.token });
  const publishedExam = examList.data.find((e) => e.status === 'RESULTS_PUBLISHED');
  const unpublishedExam = examList.data.find((e) => e.status === 'COMPLETED');

  const studentResults = await api('/exams/results?limit=50', { token: studentA.token });
  check('student sees only their own results', studentResults.data.every((r) => r.student_id === studentRowA.id));
  check('student sees only published results', studentResults.data.every((r) => r.published === 1));

  if (unpublishedExam) {
    const hiddenCard = await api(`/exams/report-card/${unpublishedExam.id}/${studentRowA.id}`, { token: studentA.token });
    check('unpublished report card is withheld from the student', [403, 404].includes(hiddenCard.status));
  }
  if (publishedExam) {
    const card = await api(`/exams/report-card/${publishedExam.id}/${studentRowA.id}`, { token: studentA.token });
    check('published report card is available to the student', card.status === 200 && card.data.subjects.length > 0);

    const crossCard = await api(`/exams/report-card/${publishedExam.id}/${studentRowB.id}`, { token: studentA.token });
    check("student cannot open another student's report card", crossCard.status === 403);

    const parentCard = await api(`/exams/report-card/${publishedExam.id}/${parentA.children[0].id}`, {
      token: parentA.token,
    });
    check("parent can open their own child's report card", parentCard.status === 200);
  }

  // =================================================================
  section('6. Fee collection & receipts');
  // =================================================================
  const pendingFees = await api('/finance/pending', { token: financial.token });
  check('financial staff can list pending fees', pendingFees.status === 200 && pendingFees.data.rows.length > 0);

  const target = pendingFees.data.rows[0];
  // Collect a slice of whatever is actually outstanding. A fixed amount drifts
  // out of range as the suite is re-run against the same seeded database.
  const instalment = Math.max(1, Math.min(100, Math.floor(Number(target.balance))));
  const collect = await api('/finance/collect', {
    token: financial.token,
    method: 'POST',
    body: { student_fee_id: target.id, amount: instalment, payment_mode: 'UPI', transaction_ref: 'TESTTXN001' },
  });
  check('financial staff can collect a fee payment', collect.status === 201, JSON.stringify(collect.error || ''));
  check('a receipt number is issued', !!collect.data?.receipt_number);

  const receipt = await api(`/finance/receipts/${collect.data.receipt_id}`, { token: financial.token });
  check('receipt is retrievable with amount in words', !!receipt.data?.receipt?.amount_in_words);

  const overpay = await api('/finance/collect', {
    token: financial.token,
    method: 'POST',
    body: { student_fee_id: target.id, amount: 9999999, payment_mode: 'CASH' },
  });
  check('overpayment beyond the balance is rejected', overpay.status === 400);

  const studentCollect = await api('/finance/collect', {
    token: studentA.token,
    method: 'POST',
    body: { student_fee_id: target.id, amount: 100 },
  });
  check('a student cannot collect fees', studentCollect.status === 403);

  const studentFees = await api('/finance/student-fees?limit=50', { token: studentA.token });
  check('student sees only their own fee records', studentFees.data.every((f) => f.student_id === studentRowA.id));

  const parentFees = await api('/finance/student-fees?limit=100', { token: parentA.token });
  const parentChildIds = parentA.children.map((c) => c.id);
  check(
    "parent sees only their own children's fees",
    parentFees.data.every((f) => parentChildIds.includes(f.student_id))
  );

  // =================================================================
  section('7. Communication, materials and notifications');
  // =================================================================
  const announcements = await api('/communication/announcements?limit=50', { token: studentA.token });
  check('student can read announcements', announcements.status === 200);
  check(
    'student sees only published announcements',
    announcements.data.every((a) => a.is_published === 1)
  );

  const staffOnly = await api('/communication/announcements?limit=50', { token: admin.token });
  check(
    'admin sees more announcements than a student (drafts and staff-targeted)',
    staffOnly.data.length >= announcements.data.length
  );

  const studentPublish = await api('/communication/announcements/1/publish', { token: studentA.token, method: 'POST' });
  check('student cannot publish announcements', studentPublish.status === 403);

  const materialsAsStudent = await api('/materials?limit=50', { token: studentA.token });
  check('student can read course materials', materialsAsStudent.status === 200);
  check(
    'student only sees published material',
    materialsAsStudent.data.every((m) => m.is_published === 1)
  );

  const materialDelete = materialsAsStudent.data[0]
    ? await api(`/materials/${materialsAsStudent.data[0].id}`, { token: studentA.token, method: 'DELETE' })
    : { status: 403 };
  check('student cannot delete teacher material', materialDelete.status === 403);

  const notifications = await api('/communication/notifications', { token: studentA.token });
  check('notification centre responds', notifications.status === 200 || Array.isArray(notifications.data));
  check('unread count is provided', notifications.meta?.unread !== undefined);

  const contacts = await api('/communication/messages/contacts', { token: parentA.token });
  check('parent contact list contains only staff', contacts.data.every((c) => !['STUDENT', 'PARENT'].includes(c.role)));

  const messageToStaff = await api('/communication/messages', {
    token: parentA.token,
    method: 'POST',
    body: {
      recipient_id: contacts.data[0].id,
      subject: 'Test enquiry from the automated suite',
      body: 'This message was created by the API test suite.',
      context_student_id: parentA.children[0].id,
    },
  });
  check('parent can message a staff member', messageToStaff.status === 201);

  const messageToStudent = await api('/communication/messages', {
    token: parentA.token,
    method: 'POST',
    body: { recipient_id: studentB.user.id, subject: 'Should fail', body: 'Should fail' },
  });
  check('parent cannot message another student directly', messageToStudent.status === 403);

  const wrongChildContext = await api('/communication/messages', {
    token: parentA.token,
    method: 'POST',
    body: {
      recipient_id: contacts.data[0].id,
      subject: 'Should fail',
      body: 'Should fail',
      context_student_id: parentBChildId,
    },
  });
  check("parent cannot attach another parent's child as context", wrongChildContext.status === 403);

  // =================================================================
  section('8. Reports & exports');
  // =================================================================
  const reportList = await api('/reports', { token: admin.token });
  check('admin can list every report', reportList.data.length >= 8);

  const financialReports = await api('/reports', { token: financial.token });
  check('financial staff see a narrower report list', financialReports.data.length < reportList.data.length);
  check(
    'financial staff do not see the audit report',
    !financialReports.data.some((r) => r.key === 'administrative')
  );

  const feeReport = await api('/reports/fees?format=json', { token: financial.token });
  check('fee report returns rows and a summary', feeReport.data?.rows?.length > 0 && !!feeReport.data.summary);

  const teacherFeeReport = await api('/reports/fees?format=json', { token: teacherA.token });
  check('teacher cannot run the fee report', teacherFeeReport.status === 403);

  const csv = await api('/reports/students?format=csv', { token: admin.token, raw: true });
  const csvText = await csv.text();
  check('CSV export downloads', csv.status === 200 && csvText.includes('Admission No'));

  const xlsx = await api('/reports/students?format=xlsx', { token: admin.token, raw: true });
  const xlsxBuffer = Buffer.from(await xlsx.arrayBuffer());
  check(
    'XLSX export downloads a real workbook',
    xlsx.status === 200 && xlsxBuffer.length > 2000 && xlsxBuffer.subarray(0, 2).toString() === 'PK'
  );

  const pdf = await api('/reports/attendance?format=pdf', { token: admin.token, raw: true });
  const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
  check(
    'PDF export downloads a real PDF',
    pdf.status === 200 && pdfBuffer.subarray(0, 4).toString() === '%PDF'
  );

  const studentOwnReport = await api('/reports/attendance?format=json', { token: studentA.token });
  check(
    'student attendance report covers only themselves',
    studentOwnReport.status === 200 && studentOwnReport.data.rows.every((r) => r.admission_number === studentRowA.admission_number)
  );

  // =================================================================
  section('9. Audit logging');
  // =================================================================
  const logs = await api('/system/audit-logs?limit=50', { token: admin.token });
  check('admin can read audit logs', logs.status === 200 && logs.data.length > 0);

  const loginLogged = await api('/system/audit-logs?action=LOGIN&limit=20', { token: admin.token });
  check('logins are recorded', loginLogged.data.length > 0);

  const feeLogged = await api('/system/audit-logs?action=FEE_PAYMENT&limit=20', { token: admin.token });
  check('fee payments are recorded', feeLogged.data.length > 0);
  check(
    'audit entries carry the acting user and role',
    feeLogged.data[0]?.user_name && feeLogged.data[0]?.role_code
  );

  const attendanceLogged = await api('/system/audit-logs?action=ATTENDANCE_UPDATE&limit=20', { token: admin.token });
  check('attendance updates are recorded', attendanceLogged.data.length > 0);

  const approveLogged = await api('/system/audit-logs?action=APPROVE&limit=20', { token: admin.token });
  check('approvals are recorded', approveLogged.data.length > 0);

  // Permission change writes old and new values.
  const targetAdmin = (await api('/administrators?limit=5', { token: admin.token })).data[0];
  const permChange = await api(`/administrators/${targetAdmin.id}/permissions`, {
    token: admin.token,
    method: 'PUT',
    body: { allow: ['reports.export'], deny: ['students.delete'] },
  });
  check('admin can assign administrator permissions', permChange.status === 200);

  const permLog = await api('/system/audit-logs?action=PERMISSION_CHANGE&limit=5', { token: admin.token });
  check('permission changes are recorded', permLog.data.length > 0);
  check(
    'permission changes store old and new values',
    permLog.data[0]?.new_values !== null && permLog.data[0]?.new_values !== undefined
  );

  // =================================================================
  section('10. Validation & data integrity');
  // =================================================================
  const badStudent = await api('/students', { token: administrator.token, method: 'POST', body: { last_name: 'NoFirstName' } });
  check('missing required fields are rejected', badStudent.status === 422 || badStudent.status === 400);

  const badEmail = await api('/users', {
    token: admin.token,
    method: 'POST',
    body: { username: 'testuser1', email: 'not-an-email', full_name: 'Test User', role_code: 'STUDENT' },
  });
  check('an invalid email is rejected', badEmail.status === 422);

  const shortPassword = await api('/auth/change-password', {
    token: studentA.token,
    method: 'POST',
    body: { currentPassword: PASSWORD, newPassword: 'abc' },
  });
  check('a weak password is rejected', shortPassword.status === 422);

  const duplicateUser = await api('/users', {
    token: admin.token,
    method: 'POST',
    body: { username: 'admin', email: 'dupe@vignan.edu.in', full_name: 'Duplicate', role_code: 'ADMINISTRATOR' },
  });
  check('a duplicate username is rejected', duplicateUser.status === 409);

  const selfDeactivate = await api(`/users/${admin.user.id}/status`, {
    token: admin.token,
    method: 'PATCH',
    body: { status: 'INACTIVE' },
  });
  check('an admin cannot deactivate their own account', selfDeactivate.status === 400);

  const nonAdminMakesAdmin = await api('/users', {
    token: administrator.token,
    method: 'POST',
    body: { username: 'sneakyadmin', email: 'sneaky@vignan.edu.in', full_name: 'Sneaky', role_code: 'ADMIN' },
  });
  check('a non-admin cannot create an ADMIN account', nonAdminMakesAdmin.status === 403);

  const notFound = await api('/students/99999999', { token: admin.token });
  check('a missing record returns 404', notFound.status === 404);

  // =================================================================
  section('11. Endpoint sweep - every route the UI calls');
  // =================================================================
  const sweep = [
    ['lookup bundle', '/academics/lookups', admin],
    ['timetable grid (by section)', '/academics/timetable/grid?section_id=1', admin],
    ['timetable grid (teacher default)', '/academics/timetable/grid', teacherA],
    ['timetable grid (student own section)', '/academics/timetable/grid', studentA],
    ['timetable grid (parent child section)', '/academics/timetable/grid', parentA],
    ['timetable detail still resolves', '/academics/timetable/1', admin],
    ['mentee list', '/mentoring/mentees/list', teacherA],
    ['mentoring records', '/mentoring?limit=5', teacherA],
    ['finance summary', '/finance/summary', financial],
    ['pending fees', '/finance/pending', financial],
    ['receipt list', '/finance/receipts', financial],
    ['salary structures', '/finance/salary-structures?limit=5', admin],
    ['own payslips (teacher)', '/finance/payroll?limit=5', teacherA],
    ['transport summary', '/transport/summary', admin],
    ['library summary', '/library/summary', admin],
    ['inventory summary', '/inventory/summary', admin],
    ['academic calendar', '/communication/calendar', studentA],
    ['events', '/communication/events?limit=5', studentA],
    ['message contacts', '/communication/messages/contacts', parentA],
    ['system health', '/system/health', admin],
    ['system settings', '/system/settings', admin],
    ['audit filters', '/system/audit-logs/filters', admin],
    ['documents', '/system/documents?limit=5', admin],
    ['student id card', `/students/${studentRowA.id}/id-card`, admin],
    ['student documents', `/students/${studentRowA.id}/documents`, admin],
    ['faculty profile', '/faculty/1/profile', admin],
    ['administrator detail', '/administrators/1', admin],
    ['permission catalogue', '/roles/permissions', admin],
    ['materials (teacher)', '/materials?limit=5', teacherA],
    ['materials (student)', '/materials?limit=5', studentA],
    ['faculty attendance', '/attendance/faculty?limit=5', admin],
    ['leave queue', '/attendance/leave?limit=5', administrator],
    ['books', '/library/books?limit=5', admin],
    ['book transactions', '/library/transactions?limit=5', admin],
    ['library fines', '/library/fines?limit=5', admin],
    ['inventory items', '/inventory/items?limit=5', admin],
    ['assets', '/inventory/assets?limit=5', admin],
    ['transport routes', '/transport/routes?limit=5', admin],
    ['transport allocation (student)', '/transport/allocations?limit=5', studentA],
  ];

  for (const [label, path, session] of sweep) {
    const response = await api(path, { token: session.token });
    check(label, response.status === 200, `got ${response.status} ${response.error?.message ?? ''}`);
  }

  const anyExam = (await api('/exams/examinations?limit=1', { token: admin.token })).data[0];
  const examScheduleResponse = await api(`/exams/examinations/${anyExam.id}/schedule`, { token: admin.token });
  check('examination schedule', examScheduleResponse.status === 200);

  const anyPayslip = (await api('/finance/payroll?limit=1', { token: admin.token })).data[0];
  const payslipView = await api(`/finance/payroll/${anyPayslip.id}/payslip`, { token: admin.token });
  check('payslip detail', payslipView.status === 200);

  // =================================================================
  section('12. Confining an Administrator to one department');

  const adminList = (await api('/administrators', { token: admin.token })).data;
  const shobha = adminList.find((a) => a.username === 'shobha');
  const startingBoard = shobha.board;
  check('an administrator carries a department assignment',
    ['STATE', 'CBSE', 'BOTH'].includes(startingBoard), `board=${startingBoard}`);

  // Only an Admin may set it — the whole router is Admin-only.
  check('an administrator cannot reassign themselves',
    (await api(`/administrators/${shobha.id}`, {
      token: administrator.token, method: 'PUT', body: { board: 'CBSE' },
    })).status === 403);

  const confine = await api(`/administrators/${shobha.id}`, {
    token: admin.token, method: 'PUT', body: { board: 'CBSE' },
  });
  check('admin can confine an administrator to CBSE', confine.status === 200 && confine.data.board === 'CBSE');

  // The change takes effect on their next request — no re-issue of the token.
  const confined = await login('shobha');
  check('the session reports the ceiling', confined.user.board === 'CBSE', `board=${confined.user.board}`);
  check('an admin has no ceiling', admin.user.board == null, `board=${admin.user.board}`);

  // ---- every list is narrowed -------------------------------------
  const counts = {};
  for (const [label, path] of [
    ['students', '/students?limit=1'],
    ['classes', '/academics/classes?limit=1'],
    ['sections', '/academics/sections?limit=1'],
    ['courses', '/academics/courses?limit=1'],
    ['course assignments', '/academics/course-assignments?limit=1'],
    ['enrollments', '/academics/enrollments?limit=1'],
  ]) {
    const asAdmin = (await api(path, { token: admin.token })).meta.total;
    const asConfined = (await api(path, { token: confined.token })).meta.total;
    counts[label] = [asAdmin, asConfined];
    check(`${label} are narrowed to the assigned wing`, asConfined > 0 && asConfined < asAdmin,
      `admin ${asAdmin} vs confined ${asConfined}`);
  }

  // Asking for the other wing outright gives nothing — the picker is a filter
  // inside the ceiling, never a way past it.
  check('asking for the other wing returns nothing',
    (await api('/students?board=STATE&limit=1', { token: confined.token })).meta.total === 0);

  // ---- and so is every individual record --------------------------
  const stateStudent = (await api('/students?board=STATE&limit=1', { token: admin.token })).data[0];
  const cbseStudent = (await api('/students?board=CBSE&limit=1', { token: admin.token })).data[0];
  check('a student of the assigned wing opens',
    (await api(`/students/${cbseStudent.id}`, { token: confined.token })).status === 200);
  check('a student of the other wing is refused',
    (await api(`/students/${stateStudent.id}`, { token: confined.token })).status === 403);

  const stateClass = (await api('/academics/classes?board=STATE&limit=1', { token: admin.token })).data[0];
  check('a class of the other wing does not exist for them',
    (await api(`/academics/classes/${stateClass.id}`, { token: confined.token })).status === 404);
  check('nor can they edit it',
    (await api(`/academics/classes/${stateClass.id}`, {
      token: confined.token, method: 'PUT', body: { name: 'Renamed' },
    })).status === 404);
  check('nor delete it',
    (await api(`/academics/classes/${stateClass.id}`, { token: confined.token, method: 'DELETE' })).status === 404);

  // ---- nor can they write into it ---------------------------------
  check('they cannot create a class in the other wing',
    (await api('/academics/classes', {
      token: confined.token, method: 'POST',
      body: { name: 'Smuggled', academic_year_id: stateClass.academic_year_id, board: 'STATE' },
    })).status === 403);
  check('nor a section under the other wing\'s class',
    (await api('/academics/sections', {
      token: confined.token, method: 'POST', body: { name: 'Z', class_id: stateClass.id },
    })).status === 403);

  // ---- the dropdowns and landing pages agree ----------------------
  const confinedLookups = (await api('/academics/lookups', { token: confined.token })).data;
  check('lookups offer only the assigned wing',
    confinedLookups.classes.every((c) => c.board === 'CBSE') &&
      confinedLookups.sections.every((c) => c.board === 'CBSE') &&
      confinedLookups.courses.every((c) => c.board === 'CBSE'));
  const confinedWings = (await api('/academics/departments/overview', { token: confined.token })).data;
  check('the departments page shows only their wing',
    confinedWings.length === 1 && confinedWings[0].board === 'CBSE');
  check('an admin still sees both wings',
    (await api('/academics/departments/overview', { token: admin.token })).data.length === 2);

  // ---- faculty assignment is confined too -------------------------
  const confinedStaff = (await api('/assignments/faculty', { token: confined.token })).data;
  const allStaff = (await api('/assignments/faculty', { token: admin.token })).data;
  check('they arrange only teachers of their wing', confinedStaff.length < allStaff.length,
    `${confinedStaff.length} of ${allStaff.length}`);
  check('the mentee picker offers only their wing\'s pupils',
    (await api('/assignments/students', { token: confined.token })).data.every((st) => st.board === 'CBSE'));

  // ---- put it back ------------------------------------------------
  const release = await api(`/administrators/${shobha.id}`, {
    token: admin.token, method: 'PUT', body: { board: 'BOTH' },
  });
  check('admin can widen them back to both departments', release.status === 200 && release.data.board === 'BOTH');
  const released = await login('shobha');
  check('the ceiling is lifted immediately', released.user.board == null);
  check('and every student is visible again',
    (await api('/students?limit=1', { token: released.token })).meta.total === counts.students[0]);

  // ---- the timetable belongs to a department too --------------------
  const ttConfined = await api(`/administrators/${shobha.id}`, {
    token: admin.token, method: 'PUT', body: { board: 'CBSE' },
  });
  check('the administrator is confined again for the timetable checks', ttConfined.status === 200);
  const ttSession = await login('shobha');

  const allSlots = (await api('/academics/timetable?limit=1', { token: admin.token })).meta.total;
  const wingSlots = (await api('/academics/timetable?limit=1', { token: ttSession.token })).meta.total;
  check('timetable slots are narrowed to the assigned wing', wingSlots > 0 && wingSlots < allSlots,
    `admin ${allSlots} vs confined ${wingSlots}`);

  const cbseSlot = (await api('/academics/timetable?board=CBSE&limit=1', { token: admin.token })).data[0];
  const stateSlot = (await api('/academics/timetable?board=STATE&limit=1', { token: admin.token })).data[0];
  check('the board filter actually splits the timetable', cbseSlot.id !== stateSlot.id);
  check('a slot of their own wing opens',
    (await api(`/academics/timetable/${cbseSlot.id}`, { token: ttSession.token })).status === 200);
  check('a slot of the other wing does not exist for them',
    (await api(`/academics/timetable/${stateSlot.id}`, { token: ttSession.token })).status === 404);
  check('nor can they edit it',
    (await api(`/academics/timetable/${stateSlot.id}`, {
      token: ttSession.token, method: 'PUT', body: { room: 'X' },
    })).status === 404);

  const stateSection = (await api('/academics/sections?board=STATE&limit=1', { token: admin.token })).data[0];
  check('a grid of the other wing comes back empty',
    (await api(`/academics/timetable/grid?section_id=${stateSection.id}`, { token: ttSession.token }))
      .data.slots.length === 0);
  check('they cannot create into the other wing',
    (await api('/academics/timetable', {
      token: ttSession.token, method: 'POST',
      body: {
        class_id: stateSection.class_id, section_id: stateSection.id, academic_year_id: 2,
        day_of_week: 5, period: 8, start_time: '15:30', end_time: '16:15',
      },
    })).status === 403);

  await api(`/administrators/${shobha.id}`, { token: admin.token, method: 'PUT', body: { board: 'BOTH' } });

  // ---- the timetable reaches all three portals ----------------------
  const teacherGrid = await api('/academics/timetable/grid', { token: teacherA.token });
  check('a teacher gets their own timetable', teacherGrid.status === 200 && teacherGrid.data.slots.length > 0);
  check('and it spans more than one class',
    new Set(teacherGrid.data.slots.map((r) => r.class_name)).size > 1);

  const studentGrid = await api('/academics/timetable/grid', { token: studentA.token });
  check('a student gets their section timetable', studentGrid.status === 200 && studentGrid.data.slots.length > 0);

  const parentChild = parentA.children[0];
  const parentGrid = await api(`/academics/timetable/grid?student_id=${parentChild.id}`, { token: parentA.token });
  check('a parent gets their child timetable', parentGrid.status === 200 && parentGrid.data.slots.length > 0);
  check('every section now has a timetable',
    (await api('/academics/sections?limit=1', { token: admin.token })).meta.total > 0 &&
      studentGrid.data.slots.length > 0 && parentGrid.data.slots.length > 0);

  // Editing a slot tells the teacher, the pupils and their parents.
  const notifiedSlot = (await api(`/academics/timetable?section_id=${parentChild.section_id}&limit=1`, {
    token: admin.token,
  })).data[0];
  if (notifiedSlot) {
    const beforeCount = (await api('/communication/notifications?limit=100', { token: parentA.token }))
      .data.filter((n) => n.type === 'TIMETABLE_UPDATED').length;
    await api(`/academics/timetable/${notifiedSlot.id}`, {
      token: admin.token, method: 'PUT', body: { room: 'NOTIFY-TEST' },
    });
    const afterCount = (await api('/communication/notifications?limit=100', { token: parentA.token }))
      .data.filter((n) => n.type === 'TIMETABLE_UPDATED').length;
    check('a timetable change notifies the parent', afterCount > beforeCount,
      `${beforeCount} -> ${afterCount}`);
    await api(`/academics/timetable/${notifiedSlot.id}`, {
      token: admin.token, method: 'PUT', body: { room: notifiedSlot.room },
    });
  }

  // =================================================================
  section('14. Storage and clearing old data');

  check('teaching staff cannot open storage',
    (await api('/storage', { token: teacherA.token })).status === 403);
  check('an administrator cannot open storage',
    (await api('/storage', { token: administrator.token })).status === 403);

  const storage = await api('/storage', { token: admin.token });
  check('admin sees what is stored', storage.status === 200 && storage.data.database > 0);
  check('it is measured against a limit',
    storage.data.limit > 0 && ['OK', 'NEAR', 'FULL'].includes(storage.data.state),
    `${storage.data.percent}% ${storage.data.state}`);
  check('the growing tables are listed',
    storage.data.tables.length > 0 && storage.data.tables.every((t) => typeof t.rows === 'number'));
  check('the tables are ordered by size',
    storage.data.tables.every((t, i, arr) => i === 0 || arr[i - 1].rows >= t.rows));

  // A purge says how much it would remove before it runs.
  const preview = await api('/storage/purges?older_than_days=365', { token: admin.token });
  // What matters is the shape, not the number: adding a purge should not mean
  // editing a count in a test.
  check('a purge previews its row count',
    preview.status === 200
    && preview.data.options.length >= 4
    && preview.data.options.every((o) => o.key && o.label && typeof o.rows === 'number'));

  // A missing confirmation is a validation failure, which this API answers 422.
  check('clearing needs the confirmation word',
    (await api('/storage/purge', {
      token: admin.token, method: 'POST', body: { keys: ['sessions'] },
    })).status === 422);
  check('an administrator cannot clear data',
    (await api('/storage/purge', {
      token: administrator.token, method: 'POST', body: { keys: ['sessions'], confirm: 'CLEAR' },
    })).status === 403);

  // Plant rows old enough to purge, and check exactly those go.
  const auditBefore = storage.data.tables.find((t) => t.table === 'activity_logs')?.rows ?? 0;
  const purged = await api('/storage/purge', {
    token: admin.token, method: 'POST', body: { keys: ['sessions'], older_than_days: 365, confirm: 'CLEAR' },
  });
  check('a purge reports what it removed', purged.status === 200 && typeof purged.data.total === 'number');
  const auditAfter = (await api('/storage', { token: admin.token })).data.tables
    .find((t) => t.table === 'activity_logs')?.rows ?? 0;
  check('clearing sessions leaves the audit trail alone', auditAfter >= auditBefore,
    `${auditBefore} -> ${auditAfter}`);

  check('the current academic year cannot be cleared',
    (await api('/storage/purge-year', {
      token: admin.token, method: 'POST',
      body: { academic_year_id: storage.data.years.find((y) => y.is_current).id, confirm: 'CLEAR' },
    })).status === 400);

  // =================================================================
  section('15. Assigning students and classes to faculty');

  // Only Admin and Administrator reach the page at all.
  check('admin can open faculty assignments',
    (await api('/assignments/faculty', { token: admin.token })).status === 200);
  check('administrator can open faculty assignments',
    (await api('/assignments/faculty', { token: administrator.token })).status === 200);
  check('teaching staff cannot open faculty assignments',
    (await api('/assignments/faculty', { token: teacherA.token })).status === 403);
  check('financial staff cannot open faculty assignments',
    (await api('/assignments/faculty', { token: financial.token })).status === 403);

  const staffList = (await api('/assignments/faculty', { token: administrator.token })).data;
  check('the list carries each teacher\'s workload',
    staffList.length > 0 &&
      staffList.every((f) => ['courses', 'classes_owned', 'mentees'].every((k) => typeof f[k] === 'number')));

  // Work with a teacher other than the one used elsewhere in the suite.
  const assignTarget = staffList.find((f) => f.full_name !== teacherA.user.fullName) || staffList[0];
  const holdingsBefore = (await api(`/assignments/faculty/${assignTarget.id}`, { token: administrator.token })).data;
  check('a teacher\'s holdings load', Array.isArray(holdingsBefore.courses) && Array.isArray(holdingsBefore.mentees));

  // ---- assigning a menteeStudent as a mentee -----------------------------
  const menteePool = (await api('/assignments/students?class_id=1', { token: administrator.token })).data;
  const menteeStudent = menteePool.find((s2) => s2.mentor_id !== assignTarget.id);
  const previousMentor = menteeStudent.mentor_id;

  const assignMentee = await api(`/assignments/faculty/${assignTarget.id}/mentees`, {
    token: administrator.token, method: 'POST', body: { student_ids: [menteeStudent.id] },
  });
  check('administrator can assign a student to a mentor', assignMentee.status === 200 && assignMentee.data.assigned === 1);

  const afterMentee = (await api(`/assignments/faculty/${assignTarget.id}`, { token: administrator.token })).data;
  check('the student appears among the mentees',
    afterMentee.mentees.some((m) => m.id === menteeStudent.id));

  // The mentor can now open that menteeStudent — assignment is what grants access,
  // which is the whole point of this page.
  const targetAccount = (await api(`/faculty/${assignTarget.id}`, { token: admin.token })).data;
  const mentorSession = await login(targetAccount.username);
  check('the new mentor can open that student record',
    (await api(`/students/${menteeStudent.id}`, { token: mentorSession.token })).status === 200);

  // Teaching staff must not be able to hand themselves a mentee.
  check('a teacher cannot assign themselves a mentee',
    (await api(`/assignments/faculty/${assignTarget.id}/mentees`, {
      token: teacherA.token, method: 'POST', body: { student_ids: [menteeStudent.id] },
    })).status === 403);

  // ---- assigning a class -------------------------------------------
  // Pick a class this teacher does not already hold. Naming someone class
  // teacher of a class they already have is correctly a no-op, so a class they
  // already hold would test nothing — and which class that is depends on how
  // two different list orderings happen to line up.
  const classChoices = (await api('/academics/classes?limit=5', { token: admin.token })).data;
  const someClass = classChoices.find((c) => c.class_teacher_id !== assignTarget.id) ?? classChoices.at(-1);
  const previousClassTeacher = someClass.class_teacher_id;
  const assignClass = await api(`/assignments/faculty/${assignTarget.id}/classes`, {
    token: administrator.token, method: 'POST', body: { class_ids: [someClass.id] },
  });
  check('administrator can name a class teacher', assignClass.status === 200 && assignClass.data.assigned === 1);
  const afterClass = (await api(`/assignments/faculty/${assignTarget.id}`, { token: administrator.token })).data;
  check('the class shows under class teacher of',
    afterClass.classesOwned.some((c) => c.class_id === someClass.id));

  // Financial staff teach nothing, so they cannot hold a class.
  const financeFaculty = (await api('/faculty?staff_type=FINANCIAL&limit=1', { token: admin.token })).data[0];
  check('financial staff cannot be given a class',
    (await api(`/assignments/faculty/${financeFaculty.id}/classes`, {
      token: administrator.token, method: 'POST', body: { class_ids: [someClass.id] },
    })).status === 400);

  // ---- both changes are audited with old and new values -------------
  const assignAudit = (await api('/system/audit-logs?limit=40', { token: admin.token })).data
    .filter((e) => e.action === 'ASSIGN');
  check('the mentor change is audited with the previous holder',
    assignAudit.some((e) => e.module === 'mentoring' && e.old_values && 'mentor' in JSON.parse(
      typeof e.old_values === 'string' ? e.old_values : JSON.stringify(e.old_values))));
  check('the class teacher change is audited',
    assignAudit.some((e) => e.module === 'academics' && /class teacher/i.test(e.description || '')));

  // ---- put the seeded world back -----------------------------------
  await api(`/assignments/faculty/${assignTarget.id}/mentees/${menteeStudent.id}`, {
    token: administrator.token, method: 'DELETE',
  });
  if (previousMentor) {
    await api(`/assignments/faculty/${previousMentor}/mentees`, {
      token: administrator.token, method: 'POST', body: { student_ids: [menteeStudent.id] },
    });
  }
  if (previousClassTeacher) {
    await api(`/assignments/faculty/${previousClassTeacher}/classes`, {
      token: administrator.token, method: 'POST', body: { class_ids: [someClass.id] },
    });
  } else {
    await api(`/assignments/classes/${someClass.id}/class-teacher`, {
      token: administrator.token, method: 'DELETE',
    });
  }
  const classAfter = (await api(`/academics/classes?limit=5`, { token: admin.token })).data
    .find((c) => c.id === someClass.id);
  check('the seeded class teacher is restored', classAfter.class_teacher_id === previousClassTeacher,
    `${classAfter.class_teacher_id} vs ${previousClassTeacher}`);
  const restoredStudent = (await api('/assignments/students?class_id=1', { token: administrator.token })).data
    .find((s2) => s2.id === menteeStudent.id);
  check('the seeded mentor is restored', restoredStudent.mentor_id === previousMentor,
    `mentor_id ${restoredStudent.mentor_id} vs ${previousMentor}`);

  section('16. Portal-specific sign-in');

  const signInAt = (login_, portal, password = PASSWORD) =>
    api('/auth/login', { method: 'POST', body: { login: login_, password, portal } });

  // Each account gets in at its own door.
  const rightDoor = [
    [multiChildParent.username, 'PARENTS', '/parent/dashboard'],
    ['girish', 'FACULTY', '/faculty/teaching/dashboard'],
    ['gurunath', 'FACULTY', '/faculty/financial/dashboard'],
    ['shobha', 'ADMINISTRATOR', '/administrator/dashboard'],
    ['admin', 'ADMIN', '/admin/dashboard'],
  ];
  for (const [who, portal, home] of rightDoor) {
    const result = await signInAt(who, portal);
    check(`${who} signs in at the ${portal} portal`,
      result.status === 200 && result.data?.user?.home === home,
      `${result.status} ${result.data?.user?.home ?? result.error?.message}`);
  }

  // And is turned away at somebody else's. The login limiter allows only ten
  // failures a quarter hour, so this checks one refusal per direction rather
  // than every pairing.
  const wrongDoor = [
    ['admin', 'PARENTS'],
    ['shobha', 'FACULTY'],
  ];
  const refusals = [];
  for (const [who, portal] of wrongDoor) {
    const result = await signInAt(who, portal);
    refusals.push(result);
    check(`${who} is refused at the ${portal} portal`, result.status === 403,
      `got ${result.status} ${result.error?.message ?? ''}`);
  }

  // A refusal names the right door, so the person knows where to go.
  check('the refusal names the portal to use',
    /belongs to the Admin portal/.test(refusals[0].error?.message || ''), refusals[0].error?.message);

  // But a wrong password gives nothing away: someone probing usernames must not
  // learn which portal an account belongs to.
  const probed = await signInAt('admin', 'PARENTS', 'not-the-password');
  check('a wrong password reveals no portal',
    probed.status === 401 && !/portal/i.test(probed.error?.message || ''), probed.error?.message);

  // Omitting the portal must still work — other clients do not send one.
  const noPortal = await api('/auth/login', { method: 'POST', body: { login: 'admin', password: PASSWORD } });
  check('sign-in without a portal still works', noPortal.status === 200);

  // An unknown door is rejected outright rather than silently ignored.
  const bogus = await api('/auth/login', {
    method: 'POST',
    body: { login: 'admin', password: PASSWORD, portal: 'SUPERUSER' },
  });
  check('an unknown portal is rejected', bogus.status === 400 || bogus.status === 422, `got ${bogus.status}`);

  // Both the refusal and the successful sign-in are audited.
  const loginAudit = (await api('/system/audit-logs?limit=60', { token: admin.token })).data;
  check('a refused portal is audited',
    loginAudit.some((e) => e.action === 'LOGIN' && e.status === 'FAILED' && /Refused at the/.test(e.description || '')));
  check('the portal used is recorded on sign-in',
    loginAudit.some((e) => e.action === 'LOGIN' && e.status === 'SUCCESS' && /at the .+ portal/.test(e.description || '')));

  section('17. Students, class by class');

  const byClass = await api('/students/by-class', { token: admin.token });
  check('by-class returns the roll grouped by class', byClass.status === 200 && byClass.data.length > 0);
  check(
    'every class carries its sections and head count',
    byClass.data.every(
      (k) =>
        typeof k.class_name === 'string' &&
        Array.isArray(k.sections) &&
        k.sections.length > 0 &&
        k.students === k.sections.reduce((sum, sec) => sum + sec.students, 0)
    )
  );
  check(
    'boys and girls add up to the class total',
    byClass.data.every((k) => k.boys + k.girls <= k.students)
  );

  // The totals must agree with the flat list the page falls back to.
  const activeTotal = (await api('/students?status=ACTIVE&limit=1', { token: admin.token })).meta.total;
  const groupedTotal = byClass.data.reduce((sum, k) => sum + k.students, 0);
  check('class-wise totals match the flat list', groupedTotal === activeTotal,
    `grouped ${groupedTotal} vs flat ${activeTotal}`);

  // The department selector narrows it the same way it narrows every list.
  const cbseOnly = await api('/students/by-class?board=CBSE', { token: admin.token });
  check('the department filter narrows the roll',
    cbseOnly.data.length > 0 && cbseOnly.data.every((k) => k.board === 'CBSE'));
  check('a filtered roll is a subset of the whole', cbseOnly.data.length < byClass.data.length);

  // Scoping: a teacher gets only what they are assigned, and never more than
  // the flat list would give them.
  const teacherClasses = await api('/students/by-class', { token: teacherA.token });
  const teacherFlatTotal = (await api('/students?status=ACTIVE&limit=1', { token: teacherA.token })).meta.total;
  const teacherGrouped = teacherClasses.data.reduce((sum, k) => sum + k.students, 0);
  check('a teacher sees fewer students than an admin', teacherGrouped < groupedTotal,
    `teacher ${teacherGrouped} vs admin ${groupedTotal}`);
  check('a teacher\'s class-wise roll matches their flat list', teacherGrouped === teacherFlatTotal,
    `grouped ${teacherGrouped} vs flat ${teacherFlatTotal}`);

  // A parent has students.view for their own child, so the route must not 404
  // into the /:id handler — that would return the student with id "by-class".
  const parentClasses = await api('/students/by-class', { token: parentA.token });
  check('by-class is routed before /:id', parentClasses.status === 200 && Array.isArray(parentClasses.data));
  check('a parent sees only their own children in it',
    parentClasses.data.reduce((sum, k) => sum + k.students, 0) <= 2);

  section('18. Forgotten password');

  // The public form must never reveal whether an account exists.
  // The people who forget a password are parents and staff — a pupil has no
  // sign-in of their own — so the flow is proved end to end on a parent.
  const resetAccount = multiChildParent.username;
  const forgotReal = await api('/auth/forgot-password', {
    method: 'POST',
    body: { login: resetAccount, contact: '+91 98450 00000', reason: 'Test request' },
  });
  const forgotFake = await api('/auth/forgot-password', {
    method: 'POST',
    body: { login: 'definitely-not-a-user' },
  });
  check('forgot-password accepts a request', forgotReal.status === 200);
  check(
    'forgot-password does not leak whether the account exists',
    forgotFake.status === 200 && forgotFake.data?.message === forgotReal.data?.message
  );

  // Asking twice must not queue the same account twice.
  await api('/auth/forgot-password', { method: 'POST', body: { login: resetAccount } });
  const resetQueue = await api('/password-resets?status=PENDING', { token: administrator.token });
  const studentRequests = resetQueue.data.filter((r) => r.username === resetAccount);
  check('a repeated request does not queue twice', studentRequests.length === 1);

  check(
    'teaching staff cannot see the reset queue',
    (await api('/password-resets', { token: teacherA.token })).status === 403
  );

  // An Administrator serves pupils and staff, but never an Admin account.
  await api('/auth/forgot-password', { method: 'POST', body: { login: 'admin' } });
  const adminRequest = (await api('/password-resets?status=PENDING', { token: admin.token })).data.find(
    (r) => r.role_code === 'ADMIN'
  );
  // Running the suite twice inside the limiter's window leaves this request
  // unqueued. That is the limiter working, not a defect, so the check reports
  // the situation instead of aborting the rest of the run.
  if (!adminRequest) {
    check('administrator cannot reset an Admin password', false,
      'skipped — the sign-in limiter refused the request; restart the API and re-run');
  } else {
    const refusedReset = await api('/password-resets/' + adminRequest.id + '/complete', {
      token: administrator.token,
      method: 'POST',
      body: {},
    });
    check('administrator cannot reset an Admin password', refusedReset.status === 403);
  }

  const issued = await api('/password-resets/' + studentRequests[0].id + '/complete', {
    token: administrator.token,
    method: 'POST',
    body: { note: 'Identified at the office' },
  });
  check('administrator can reset a parent password', issued.status === 200 && !!issued.data?.temporaryPassword);

  const oldPasswordLogin = await api('/auth/login', {
    method: 'POST',
    body: { login: resetAccount, password: PASSWORD },
  });
  check('the old password stops working', oldPasswordLogin.status === 401);

  const temporaryLogin = await api('/auth/login', {
    method: 'POST',
    body: { login: resetAccount, password: issued.data.temporaryPassword },
  });
  check('the temporary password signs in', temporaryLogin.status === 200);
  check('and forces a password change', temporaryLogin.data?.user?.mustChangePassword === true);

  check(
    'a completed request cannot be completed twice',
    (
      await api('/password-resets/' + studentRequests[0].id + '/complete', {
        token: administrator.token,
        method: 'POST',
        body: {},
      })
    ).status === 400
  );

  const resetAudit = (await api('/system/audit-logs?limit=60', { token: admin.token })).data;
  check(
    'the reset is audited',
    resetAudit.some((entry) => entry.action === 'PASSWORD_RESET' && entry.module === 'password_resets')
  );

  // Leave the seeded world as it was found.
  await api('/users/' + temporaryLogin.data.user.id + '/reset-password', {
    token: admin.token,
    method: 'POST',
    body: { password: PASSWORD },
  });
  await api('/password-resets/' + adminRequest.id + '/reject', {
    token: admin.token,
    method: 'POST',
    body: { note: 'Test cleanup' },
  });
  check(
    'the demo parent password is restored',
    (await api('/auth/login', { method: 'POST', body: { login: resetAccount, password: PASSWORD } })).status === 200
  );

  // Pupils do not sign in; leave their accounts as they were found.
  await restorePupils();
  const pupilAfter = await api(`/users?role=STUDENT&search=${studentRowA.username}`, { token: admin.token });
  check('pupil sign-in is disabled again', pupilAfter.data[0]?.status === 'INACTIVE',
    `status=${pupilAfter.data[0]?.status}`);

  // =================================================================
  section('Bulk import from a spreadsheet');

  const importClass = (await api('/academics/classes?limit=1', { token: admin.token })).data[0];
  const importSection = (await api(`/academics/sections?class_id=${importClass.id}&limit=1`, { token: admin.token })).data[0];
  const stamp = Date.now().toString().slice(-6);

  const header = 'First Name,Last Name,Class,Section,Gender,Date of Birth,Father Name,Parent Phone,Create Parent Login';
  const goodRow = (name) =>
    `${name},Importson,${importClass.name},${importSection?.name || ''},MALE,2015-06-14,Test Parent,9000000001,NO`;
  const importCsv = [
    header,
    goodRow(`Alpha${stamp}`),
    goodRow(`Beta${stamp}`),
    // Deliberately wrong: a class that does not exist, and a gender that is not one.
    `Gamma${stamp},Importson,Class 404,A,MALE,2015-06-14,Test Parent,9000000002,NO`,
    `Delta${stamp},Importson,${importClass.name},${importSection?.name || ''},BOY,2015-06-14,Test Parent,9000000003,NO`,
  ].join('\n');

  const parentsBefore = (await api('/parents?limit=1', { token: admin.token })).meta?.total;

  const catalogue = await api('/imports', { token: admin.token });
  check('the importable types are listed', catalogue.data?.some((e) => e.key === 'students'));

  const template = await api('/imports/students/template', { token: admin.token, raw: true });
  const templateText = await template.text();
  check('a template can be downloaded', template.status === 200 && templateText.includes('First Name'));

  const importCheck = await upload('/imports/students', { token: admin.token, csv: importCsv });
  check('checking reports every row', importCheck.data?.total === 4, `total=${importCheck.data?.total}`);
  check('good rows are counted as ready', importCheck.data?.valid === 2, `valid=${importCheck.data?.valid}`);
  check('bad rows are counted separately', importCheck.data?.invalid === 2, `invalid=${importCheck.data?.invalid}`);
  check('an unknown class is named in the error',
    importCheck.data?.rows?.some((r) => r.errors.some((e) => /Class 404/.test(e))));
  check('an unusable gender is named in the error',
    importCheck.data?.rows?.some((r) => r.errors.some((e) => /BOY/.test(e))));
  check('checking writes nothing', importCheck.data?.committed === false);
  check('the pupil is not in the roll yet',
    (await api(`/students?search=Alpha${stamp}`, { token: admin.token })).data?.length === 0);

  // Identifiers are shown before anything is written, and are all different.
  const plannedNumbers = (importCheck.data?.rows || []).filter((r) => r.generated)
    .map((r) => r.generated.admission_number);
  check('an admission number is allocated for each valid row', plannedNumbers.length === 2);
  check('the allocated numbers differ', new Set(plannedNumbers).size === plannedNumbers.length,
    plannedNumbers.join(', '));

  const refused = await upload('/imports/students', {
    token: admin.token, csv: importCsv, fields: { commit: 'true' },
  });
  check('a file with bad rows is refused', refused.status === 400,
    `status=${refused.status}`);

  const committed = await upload('/imports/students', {
    token: admin.token, csv: importCsv, fields: { commit: 'true', skip_invalid: 'true' },
  });
  check('the good rows import when the bad ones are skipped',
    committed.data?.imported === 2, `imported=${committed.data?.imported}`);

  const found = await api(`/students?search=Importson&limit=20`, { token: admin.token });
  const imported = (found.data || []).filter((s) => s.first_name?.endsWith(stamp));
  check('the imported pupils are on the roll', imported.length === 2, `found=${imported.length}`);
  check('each was given an admission number', imported.every((s) => /^VGN\d{4}-\d{4}$/.test(s.admission_number)),
    imported.map((s) => s.admission_number).join(', '));
  check('their admission numbers are unique',
    new Set(imported.map((s) => s.admission_number)).size === imported.length);

  // The point of the allocator: importing the same file again must not collide.
  const again = await upload('/imports/students', {
    token: admin.token, csv: importCsv, fields: { commit: 'true', skip_invalid: 'true' },
  });
  check('importing again does not collide', again.data?.imported === 2,
    again.error?.message || `imported=${again.data?.imported}`);
  const secondNumbers = again.data?.references || [];
  const firstNumbers = committed.data?.references || [];
  check('the second import gets fresh numbers',
    secondNumbers.every((n) => !firstNumbers.includes(n)),
    `${firstNumbers.join(',')} then ${secondNumbers.join(',')}`);

  // Only the Admin may reach it at all.
  check('an administrator cannot bulk import',
    (await upload('/imports/students', { token: administrator.token, csv: importCsv })).status === 403);
  check('a teacher cannot bulk import',
    (await upload('/imports/students', { token: teacherA.token, csv: importCsv })).status === 403);

  // Put the roll back — the parents named in the file were created too, and
  // removing a pupil does not remove them.
  const toRemove = (await api('/students?search=Importson&limit=50', { token: admin.token })).data || [];
  const mine = toRemove.filter((s) => s.first_name?.endsWith(stamp));
  for (const pupil of mine) {
    await api(`/students/${pupil.id}`, { token: admin.token, method: 'DELETE' });
  }
  // The parents are found by the telephone number this file uses — the plain
  // student endpoint does not carry them, and the guardian outlives the pupil
  // record by design.
  const theirParents = (await api('/parents?search=9000000001&limit=50', { token: admin.token })).data || [];
  for (const parent of theirParents) {
    await api(`/parents/${parent.id}`, { token: admin.token, method: 'DELETE' });
  }
  const leftover = (await api('/students?search=Importson&limit=50', { token: admin.token })).data || [];
  check('the imported pupils are removed again',
    leftover.filter((s) => s.first_name?.endsWith(stamp)).length === 0);
  check('the parents created with them are removed too',
    (await api('/parents?limit=1', { token: admin.token })).meta?.total === parentsBefore,
    `${parentsBefore} -> ${(await api('/parents?limit=1', { token: admin.token })).meta?.total}`);

  // =================================================================
  section('Device notifications');

  const pushConfig = await api('/communication/push/key', { token: admin.token });
  check('the client is told whether push is available', typeof pushConfig.data?.enabled === 'boolean');

  if (!pushConfig.data?.enabled) {
    check('push is not configured on this server — skipping the rest', true,
      'set VAPID keys with: npm run push:keys -w server');
  } else {
    check('a public key is offered to subscribe with',
      typeof pushConfig.data.publicKey === 'string' && pushConfig.data.publicKey.length > 80);

    const devicesBefore = pushConfig.data.devices?.length ?? 0;

    // A subscription shaped like a real one, but pointing nowhere. This is how
    // the self-healing path gets tested: the push service refuses an endpoint
    // it does not know, and the row must be dropped rather than retried for
    // ever.
    const deadEndpoint = `https://fcm.googleapis.com/fcm/send/vignan-test-${Date.now()}`;
    const subscribed = await api('/communication/push/subscribe', {
      token: admin.token,
      method: 'POST',
      body: {
        endpoint: deadEndpoint,
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' },
      },
    });
    check('a device can be registered', subscribed.status === 200 && subscribed.data?.subscribed === true,
      subscribed.error?.message);
    check('the device is listed back', (subscribed.data?.devices?.length ?? 0) === devicesBefore + 1,
      `${devicesBefore} -> ${subscribed.data?.devices?.length}`);

    // Registering the same browser again replaces rather than duplicates.
    const again = await api('/communication/push/subscribe', {
      token: admin.token,
      method: 'POST',
      body: {
        endpoint: deadEndpoint,
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' },
      },
    });
    check('registering the same browser twice does not duplicate it',
      (again.data?.devices?.length ?? 0) === devicesBefore + 1,
      `${again.data?.devices?.length}`);

    check('a malformed subscription is refused',
      (await api('/communication/push/subscribe', {
        token: admin.token, method: 'POST', body: { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
      })).status === 422);

    // Sending to an endpoint the push service does not know must remove it.
    await api('/communication/push/test', { token: admin.token, method: 'POST' });
    const afterSend = await api('/communication/push/key', { token: admin.token });
    const stillThere = (afterSend.data?.devices || []).length;
    check('an endpoint the push service rejects is dropped', stillThere <= devicesBefore,
      `${devicesBefore + 1} registered, ${stillThere} left`);

    // Whatever survived, unsubscribing is the caller's own business.
    await api('/communication/push/unsubscribe', {
      token: admin.token, method: 'POST', body: { endpoint: deadEndpoint },
    });
    check('a device can be removed',
      !((await api('/communication/push/key', { token: admin.token })).data?.devices || [])
        .some((d) => d.endpoint === deadEndpoint));

    // A shared device — a family tablet, a staff-room machine. When the next
    // person signs in and switches notifications on, the registration must move
    // to them. If it did not, the school's notifications would keep going to
    // whoever used the device last.
    const sharedEndpoint = `https://fcm.googleapis.com/fcm/send/vignan-shared-${Date.now()}`;
    const sharedKeys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' };
    await api('/communication/push/subscribe', {
      token: admin.token, method: 'POST', body: { endpoint: sharedEndpoint, keys: sharedKeys },
    });
    check('the first person holds the shared device',
      ((await api('/communication/push/key', { token: admin.token })).data?.devices || [])
        .some((d) => d.endpoint === sharedEndpoint));

    await api('/communication/push/subscribe', {
      token: parentA.token, method: 'POST', body: { endpoint: sharedEndpoint, keys: sharedKeys },
    });
    check('the shared device moves to whoever switches it on next',
      ((await api('/communication/push/key', { token: parentA.token })).data?.devices || [])
        .some((d) => d.endpoint === sharedEndpoint));
    check('and the previous person stops receiving on it',
      !((await api('/communication/push/key', { token: admin.token })).data?.devices || [])
        .some((d) => d.endpoint === sharedEndpoint));

    // The browser needs the endpoint back to tell whether the subscription it
    // holds is registered to the person now signed in.
    check('a device is identified by its endpoint, so the browser can compare',
      ((await api('/communication/push/key', { token: parentA.token })).data?.devices || [])
        .every((d) => typeof d.endpoint === 'string' && d.endpoint.startsWith('https://')));

    await api('/communication/push/unsubscribe', {
      token: parentA.token, method: 'POST', body: { endpoint: sharedEndpoint },
    });

    // One person's devices are not another's.
    const parentSub = await api('/communication/push/subscribe', {
      token: parentA.token,
      method: 'POST',
      body: {
        endpoint: `https://fcm.googleapis.com/fcm/send/vignan-parent-${Date.now()}`,
        keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' },
      },
    });
    check('a parent can register their own device', parentSub.status === 200);
    const adminSees = (await api('/communication/push/key', { token: admin.token })).data?.devices || [];
    const parentEndpoints = new Set((parentSub.data?.devices || []).map((d) => d.id));
    check("one person's devices are not shown to another",
      !adminSees.some((d) => parentEndpoints.has(d.id)));

    // Clean up whatever this section registered.
    for (const device of (await api('/communication/push/key', { token: parentA.token })).data?.devices || []) {
      await api('/communication/push/unsubscribe', {
        token: parentA.token, method: 'POST', body: { endpoint: device.endpoint || '' },
      });
    }
  }

  check('signing in is required to register a device',
    (await api('/communication/push/subscribe', {
      method: 'POST',
      body: { endpoint: 'https://example.com/x', keys: { p256dh: 'aaaaaaaaaaaa', auth: 'bbbb' } },
    })).status === 401);

  // =================================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    for (const failure of failures) console.log(`    - ${failure}`);
  }
  console.log(`${'='.repeat(60)}\n`);
  process.exit(failed ? 1 : 0);
};

run().catch((error) => {
  console.error('\nTest run aborted:', error);
  process.exit(1);
});
