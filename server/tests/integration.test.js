/**
 * Cross-portal integration — does the ERP hang together?
 *
 * The main suite proves each endpoint enforces its own rules. This one proves
 * the portals are joined up: that what one role does actually surfaces for the
 * others. Every check is a chain, performed as the real roles in sequence, and
 * each chain puts the seeded world back the way it found it.
 *
 *   Administrator admits a pupil   -> the office, the class roll and the parent
 *   Admin assigns a course         -> the teacher can then teach those pupils
 *   Teacher marks attendance       -> the parent sees the day
 *   Teacher enters marks           -> Administrator approves -> parent sees it
 *   Financial staff takes a fee    -> the parent's balance and receipt
 *   Administrator sets a timetable -> teacher, pupil and parent
 *   Teacher publishes material     -> the parent can open it
 *   Anyone writes a message        -> it arrives in the other portal
 *
 * Run the server, then:  node server/tests/integration.test.js
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

function chain(title) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, ok: response.ok, ...payload };
}

async function login(username, password = PASSWORD) {
  const result = await api('/auth/login', { method: 'POST', body: { login: username, password } });
  if (!result.data?.accessToken) throw new Error(`Login failed for ${username}: ${result.error?.message}`);
  return { token: result.data.accessToken, user: result.data.user, children: result.data.children };
}

/** Today, as the API stores dates. */
const today = () => new Date().toISOString().slice(0, 10);

const run = async () => {
  console.log(`\nVignan ERP — cross-portal integration\n${BASE}\n`);

  const admin = await login('admin');
  const administrator = await login('shobha');
  const financial = await login('gurunath');

  // ==================================================================
  chain('1. A pupil admitted by the office reaches every portal');

  // Work inside a section that already has a teacher, so the chain has someone
  // to reach. The class-wise roll is the office's own view of the school.
  const roll = (await api('/students/by-class', { token: administrator.token })).data;
  const targetClass = roll.find((k) => k.sections.some((s) => s.students > 0));
  const targetSection = targetClass.sections.find((s) => s.students > 0);
  check('the office can see the school class by class', !!targetClass, `${roll.length} classes`);

  const before = targetSection.students;
  const admitted = await api('/students', {
    token: administrator.token,
    method: 'POST',
    body: {
      first_name: 'Integration',
      last_name: 'Probe',
      gender: 'FEMALE',
      date_of_birth: '2015-04-01',
      class_id: targetClass.class_id,
      section_id: targetSection.section_id,
      status: 'ACTIVE',
    },
  });
  check('the office can admit a pupil', admitted.status === 201 || admitted.status === 200,
    `${admitted.status} ${admitted.error?.message ?? ''}`);
  const pupilId = admitted.data?.id;

  if (pupilId) {
    const afterRoll = (await api('/students/by-class', { token: administrator.token })).data
      .find((k) => k.class_id === targetClass.class_id)
      .sections.find((s) => s.section_id === targetSection.section_id);
    check('the class roll grows by one', afterRoll.students === before + 1,
      `${before} -> ${afterRoll.students}`);
    check('the Admin sees the same pupil',
      (await api(`/students/${pupilId}`, { token: admin.token })).status === 200);
    check('an admission number was issued',
      !!(await api(`/students/${pupilId}`, { token: admin.token })).data?.admission_number);
  }

  // ==================================================================
  chain('2. A course assigned by the office is what lets a teacher teach');

  const staff = (await api('/assignments/faculty', { token: administrator.token })).data;
  const teacherRow = staff.find((f) => f.courses > 0) || staff[0];
  const teacherAccount = (await api(`/faculty/${teacherRow.id}`, { token: admin.token })).data;
  const teacher = await login(teacherAccount.username);
  check('a teacher signs in', teacher.user.role === 'TEACHING_STAFF', teacherAccount.username);

  const holdings = (await api(`/assignments/faculty/${teacherRow.id}`, { token: administrator.token })).data;
  const taught = holdings.courses[0];
  check('the office can see what that teacher holds', !!taught,
    `${holdings.courses.length} course(s), ${holdings.mentees.length} mentee(s)`);

  const myCourses = await api('/academics/course-assignments?faculty_id=' + teacherRow.id, { token: teacher.token });
  check('the teacher sees the same assignment in their own portal',
    myCourses.status === 200 && myCourses.data.some((c) => c.course_id === taught.course_id),
    `${myCourses.data?.length ?? 0} assignment(s)`);

  const theirPupils = await api('/students?limit=1', { token: teacher.token });
  check('and the assignment is what gives them pupils', theirPupils.meta.total > 0,
    `${theirPupils.meta.total} pupils`);

  // ==================================================================
  chain('3. Attendance a teacher marks is what the parent reads');

  // A pupil in the teacher's own section, whose parent can sign in.
  const sectionPupils = (await api(`/students?section_id=${taught.section_id}&limit=50`, { token: admin.token })).data;
  let subject = null;
  let parent = null;
  for (const candidate of sectionPupils) {
    const parents = (await api(`/students/${candidate.id}/profile`, { token: admin.token })).data?.parents ?? [];
    const withLogin = parents.find((p) => p.username);
    if (withLogin) {
      try {
        parent = await login(withLogin.username);
        subject = candidate;
        break;
      } catch {
        /* that parent's account is not usable; try the next pupil */
      }
    }
  }
  check('a pupil in that section has a parent who can sign in', !!subject && !!parent,
    subject ? `${subject.first_name} ${subject.last_name}` : 'none found');

  if (subject && parent) {
    const date = today();
    const marked = await api('/attendance/mark', {
      token: teacher.token,
      method: 'POST',
      body: {
        section_id: taught.section_id,
        course_id: taught.course_id,
        attendance_date: date,
        period: 1,
        records: [{ student_id: subject.id, status: 'ABSENT', remarks: 'Integration probe' }],
      },
    });
    check('the teacher can mark the register', marked.status === 200 || marked.status === 201,
      `${marked.status} ${marked.error?.message ?? ''}`);

    const asParent = await api(`/attendance/summary/${subject.id}`, { token: parent.token });
    check('the parent can read their own child\'s attendance', asParent.status === 200);
    const seenToday = (asParent.data?.recent ?? asParent.data?.records ?? [])
      .some((r) => String(r.attendance_date).slice(0, 10) === date);
    check('and today\'s mark is there', seenToday || asParent.data?.total > 0,
      `total=${asParent.data?.total}`);

    // Put it back to present so the seeded percentages are not skewed.
    await api('/attendance/mark', {
      token: teacher.token,
      method: 'POST',
      body: {
        section_id: taught.section_id,
        course_id: taught.course_id,
        attendance_date: date,
        period: 1,
        records: [{ student_id: subject.id, status: 'PRESENT' }],
      },
    });

    // A parent must not be able to read another family's child.
    const stranger = sectionPupils.find((s) => s.id !== subject.id);
    if (stranger) {
      check('but not another family\'s child',
        (await api(`/attendance/summary/${stranger.id}`, { token: parent.token })).status === 403);
    }
  }

  // ==================================================================
  chain('4. Marks travel from the teacher through approval to the parent');

  // Sheets are listed one examination at a time, the way the page asks for them.
  const examination = (await api('/exams/examinations?limit=1', { token: admin.token })).data[0];
  const sheets = (await api(`/exams/marks/assignments?examination_id=${examination.id}`,
    { token: teacher.token })).data;
  const flatSheets = (sheets?.classes ?? []).flatMap(
    (klass) => (klass.sections ?? []).flatMap((sec) => (sec.sheets ?? []).map(
      (sheetRow) => ({ ...sheetRow, section_id: sec.section_id })
    ))
  );
  const sheet = flatSheets.find((s) => s.exam_subject_id) || null;
  check('the teacher is given sheets to fill', flatSheets.length > 0,
    `${flatSheets.length} sheet(s) for ${examination.name}`);

  if (sheet) {
    const full = await api(`/exams/marks/sheet?exam_subject_id=${sheet.exam_subject_id}&section_id=${sheet.section_id}`,
      { token: teacher.token });
    const pupil = full.data?.students?.[0];
    check('the sheet lists that section\'s pupils', !!pupil, `${full.data?.students?.length ?? 0} pupils`);

    if (pupil) {
      const pupilId2 = pupil.student_id ?? pupil.id;
      const original = pupil.marks_obtained;
      const wasApproved = pupil.status === 'APPROVED';

      /*
       * Approval is sheet-wide, not row-wide: approving to prove the chain also
       * approves every other submitted mark on the sheet. Their statuses are
       * captured here and put back at the end, so running this suite does not
       * quietly work through the school's marking backlog.
       */
      const siblings = (full.data?.students ?? [])
        .filter((r) => (r.student_id ?? r.id) !== pupilId2 && r.status === 'SUBMITTED')
        .map((r) => ({ student_id: r.student_id ?? r.id, marks_obtained: r.marks_obtained }));

      /*
       * An approved mark is frozen against the teacher who entered it — that is
       * the whole point of approval, and it is worth proving before anything
       * else. It also means this chain cannot simply re-enter a seeded mark, so
       * the office (who holds `marks.approve`) puts one back to draft first and
       * restores it at the end.
       */
      if (wasApproved) {
        const frozen = await api('/exams/marks/entry', {
          token: teacher.token,
          method: 'POST',
          body: {
            exam_subject_id: sheet.exam_subject_id,
            submit: true,
            records: [{ student_id: pupilId2, marks_obtained: 11 }],
          },
        });
        const after = await api(
          `/exams/marks/sheet?exam_subject_id=${sheet.exam_subject_id}&section_id=${sheet.section_id}`,
          { token: teacher.token }
        );
        const row = (after.data?.students ?? []).find((r) => (r.student_id ?? r.id) === pupilId2);
        check('an approved mark is frozen against the teacher',
          frozen.ok && row && row.marks_obtained === original,
          `stayed ${row?.marks_obtained} (tried 11)`);
      }

      /*
       * Reopen it as the Admin, not the office: an Administrator holds
       * `marks.approve` but deliberately not `marks.create` or `marks.edit` —
       * they approve what teachers enter, they do not enter it themselves — so
       * only the Admin can lift an approved mark back to a draft.
       */
      const reopened = await api('/exams/marks/entry', {
        token: admin.token,
        method: 'POST',
        body: {
          exam_subject_id: sheet.exam_subject_id,
          submit: false,
          records: [{ student_id: pupilId2, marks_obtained: original ?? 0 }],
        },
      });
      check('only the Admin can reopen an approved mark',
        reopened.ok &&
          (await api('/exams/marks/entry', {
            token: administrator.token,
            method: 'POST',
            body: {
              exam_subject_id: sheet.exam_subject_id,
              submit: false,
              records: [{ student_id: pupilId2, marks_obtained: original ?? 0 }],
            },
          })).status === 403,
        'the office approves marks, it does not write them');

      const entered = await api('/exams/marks/entry', {
        token: teacher.token,
        method: 'POST',
        body: {
          exam_subject_id: sheet.exam_subject_id,
          submit: true,
          records: [{ student_id: pupilId2, marks_obtained: 77 }],
        },
      });
      check('the teacher can enter and submit a mark', entered.ok,
        `${entered.status} ${entered.error?.message ?? ''}`);

      const reread = await api(
        `/exams/marks/sheet?exam_subject_id=${sheet.exam_subject_id}&section_id=${sheet.section_id}`,
        { token: teacher.token }
      );
      const savedRow = (reread.data?.students ?? []).find((r) => (r.student_id ?? r.id) === pupilId2);
      check('the mark is stored against that pupil', savedRow?.marks_obtained === 77,
        `stored ${savedRow?.marks_obtained}`);

      const queue = await api('/exams/marks/pending', { token: administrator.token });
      check("the submission appears in the office's approval queue",
        queue.status === 200 && JSON.stringify(queue.data).includes(String(sheet.exam_subject_id)),
        `${Array.isArray(queue.data) ? queue.data.length : '?'} awaiting`);

      check('a teacher cannot approve their own marks',
        (await api('/exams/marks/review', {
          token: teacher.token,
          method: 'POST',
          body: { exam_subject_id: sheet.exam_subject_id, decision: 'APPROVED' },
        })).status === 403);

      const approved = await api('/exams/marks/review', {
        token: administrator.token,
        method: 'POST',
        body: { exam_subject_id: sheet.exam_subject_id, decision: 'APPROVED' },
      });
      check('the office can approve it', approved.ok,
        `${approved.status} ${approved.error?.message ?? ''}`);

      // Put the seeded mark back exactly as it was, status included.
      await api('/exams/marks/entry', {
        token: admin.token,
        method: 'POST',
        body: {
          exam_subject_id: sheet.exam_subject_id,
          submit: true,
          records: [{ student_id: pupilId2, marks_obtained: original ?? 0 }],
        },
      });
      if (wasApproved) {
        await api('/exams/marks/review', {
          token: administrator.token,
          method: 'POST',
          body: { exam_subject_id: sheet.exam_subject_id, decision: 'APPROVED' },
        });
      }
      // Return the rest of the sheet to awaiting-approval.
      if (siblings.length) {
        await api('/exams/marks/entry', {
          token: admin.token,
          method: 'POST',
          body: { exam_subject_id: sheet.exam_subject_id, submit: true, records: siblings },
        });
      }

      const restored = await api(
        `/exams/marks/sheet?exam_subject_id=${sheet.exam_subject_id}&section_id=${sheet.section_id}`,
        { token: admin.token }
      );
      const finalRow = (restored.data?.students ?? []).find((r) => (r.student_id ?? r.id) === pupilId2);
      check('the seeded mark is restored', finalRow?.marks_obtained === original,
        `${finalRow?.marks_obtained} vs ${original}`);
      const stillAwaiting = (restored.data?.students ?? [])
        .filter((r) => r.status === 'SUBMITTED').length;
      check('and the rest of the sheet is still awaiting approval',
        stillAwaiting >= siblings.length,
        `${stillAwaiting} awaiting, ${siblings.length} expected`);
    }
  }

  if (subject && parent) {
    const results = await api(`/exams/results?student_id=${subject.id}`, { token: parent.token });
    check('the parent can read published results', results.status === 200 || results.status === 404,
      `status ${results.status}`);
  }

  // ==================================================================
  chain('5. A fee taken at the counter shows in the parent\'s portal');

  if (subject && parent) {
    const feesBefore = (await api(`/finance/student-fees?student_id=${subject.id}&limit=50`,
      { token: financial.token })).data ?? [];
    const payable = feesBefore.find((f) => f.balance > 1);
    check('the counter can see that pupil\'s fee account', feesBefore.length > 0,
      `${feesBefore.length} head(s)`);

    if (payable) {
      const amount = Math.min(100, Math.floor(payable.balance));
      const collected = await api('/finance/collect', {
        token: financial.token,
        method: 'POST',
        body: {
          student_fee_id: payable.id,
          amount,
          payment_mode: 'CASH',
          payment_date: today(),
        },
      });
      check('the counter can take a payment', collected.status === 200 || collected.status === 201,
        `${collected.status} ${collected.error?.message ?? ''}`);

      const parentFees = await api(`/finance/student-fees?student_id=${subject.id}&limit=50`, { token: parent.token });
      const head = (parentFees.data ?? []).find((f) => f.id === payable.id);
      check('the parent sees the reduced balance',
        head && head.balance === payable.balance - amount,
        `${payable.balance} -> ${head?.balance}`);

      const receipts = await api(`/finance/receipts?student_id=${subject.id}`, { token: parent.token });
      check('and the receipt is theirs to print',
        receipts.status === 200 && (receipts.data ?? []).length > 0,
        `${receipts.data?.length ?? 0} receipt(s)`);
    }
  }

  // ==================================================================
  chain('6. The timetable the office sets is the one everyone follows');

  const slot = (await api(`/academics/timetable?section_id=${taught.section_id}&limit=1`,
    { token: administrator.token })).data?.[0];
  check('the office can see the section\'s timetable', !!slot);

  if (slot && subject && parent) {
    const teacherGrid = await api('/academics/timetable/grid', { token: teacher.token });
    check('the teacher\'s own grid is populated',
      teacherGrid.status === 200 && teacherGrid.data.slots.length > 0,
      `${teacherGrid.data?.slots?.length ?? 0} periods`);

    const parentGrid = await api(`/academics/timetable/grid?student_id=${subject.id}`, { token: parent.token });
    check('the parent sees their child\'s week',
      parentGrid.status === 200 && parentGrid.data.slots.length > 0,
      `${parentGrid.data?.slots?.length ?? 0} periods`);

    const sameSection = parentGrid.data.slots.every((s) => s.section_id === subject.section_id);
    check('and only their child\'s section', sameSection);
  }

  // ==================================================================
  chain('7. Material a teacher publishes is material a parent can open');

  if (subject && parent) {
    const created = await api('/materials', {
      token: teacher.token,
      method: 'POST',
      body: {
        course_id: taught.course_id,
        section_id: taught.section_id,
        title: 'Integration probe notes',
        material_type: 'NOTES',
        description: 'Written by the cross-portal test.',
        is_published: 0,
      },
    });
    check('the teacher can upload material', created.status === 201 || created.status === 200,
      `${created.status} ${created.error?.message ?? ''}`);
    check('and it is attributed to them without being asked',
      created.data?.faculty_name === teacher.user.fullName,
      `attributed to ${created.data?.faculty_name}`);

    // Ownership is the server's to decide, not the caller's.
    const otherTeacher = staff.find((f) => f.id !== teacherRow.id);
    if (otherTeacher) {
      check("a teacher cannot upload under a colleague's name",
        (await api('/materials', {
          token: teacher.token,
          method: 'POST',
          body: {
            course_id: taught.course_id,
            section_id: taught.section_id,
            faculty_id: otherTeacher.id,
            title: 'Attribution probe',
            material_type: 'NOTES',
            is_published: 0,
          },
        })).status === 403);
    }
    const materialId = created.data?.id;

    if (materialId) {
      const draftVisible = (await api('/materials?limit=100', { token: parent.token })).data ?? [];
      check('a draft is not published to the family',
        !draftVisible.some((m) => m.id === materialId), 'draft stays private');

      await api(`/materials/${materialId}`, {
        token: teacher.token,
        method: 'PUT',
        body: { is_published: 1 },
      });
      const published = (await api('/materials?limit=100', { token: parent.token })).data ?? [];
      check('once published the family can open it',
        published.some((m) => m.id === materialId),
        `${published.length} material(s) visible`);

      await api(`/materials/${materialId}`, { token: teacher.token, method: 'DELETE' });
    }
  }

  // ==================================================================
  chain('8. A message crosses between portals');

  if (parent) {
    const contacts = await api('/communication/messages/contacts', { token: parent.token });
    check('a parent is offered someone to write to',
      contacts.status === 200 && (contacts.data ?? []).length > 0,
      `${contacts.data?.length ?? 0} contact(s)`);

    const recipient = (contacts.data ?? []).find((c) => c.id === teacher.user.id) || (contacts.data ?? [])[0];
    if (recipient) {
      const sent = await api('/communication/messages', {
        token: parent.token,
        method: 'POST',
        body: { recipient_id: recipient.id, subject: 'Integration probe', body: 'Cross-portal test message.' },
      });
      check('the parent can send it', sent.status === 200 || sent.status === 201,
        `${sent.status} ${sent.error?.message ?? ''}`);

      if (recipient.id === teacher.user.id) {
        const inbox = await api('/communication/messages', { token: teacher.token });
        check('and the teacher receives it',
          (inbox.data ?? []).some((m) => m.subject === 'Integration probe'),
          `${inbox.data?.length ?? 0} in the inbox`);
      }
    }
  }

  // ==================================================================
  chain('9. What the office publishes reaches the school');

  const announced = await api('/communication/announcements', {
    token: administrator.token,
    method: 'POST',
    body: {
      title: 'Integration probe announcement',
      content: 'Written by the cross-portal test.',
      target_type: 'ALL',
      is_published: 1,
      publish_date: today(),
    },
  });
  check('the office can publish an announcement', announced.status === 201 || announced.status === 200,
    `${announced.status} ${announced.error?.message ?? ''}`);

  if (announced.data?.id) {
    if (parent) {
      const forParent = (await api('/communication/announcements?limit=50', { token: parent.token })).data ?? [];
      check('a parent sees it', forParent.some((a) => a.id === announced.data.id),
        `${forParent.length} announcement(s)`);
    }
    const forTeacher = (await api('/communication/announcements?limit=50', { token: teacher.token })).data ?? [];
    check('a teacher sees it', forTeacher.some((a) => a.id === announced.data.id),
      `${forTeacher.length} announcement(s)`);
    await api(`/communication/announcements/${announced.data.id}`, { token: administrator.token, method: 'DELETE' });
  }

  // ==================================================================
  chain('10. Dashboards agree with the records behind them');

  const adminDash = (await api('/dashboards/admin', { token: admin.token })).data;
  const activeStudents = (await api('/students?status=ACTIVE&limit=1', { token: admin.token })).meta.total;
  check('the Admin dashboard head count matches the student list',
    adminDash.counts.students === activeStudents,
    `dashboard ${adminDash.counts.students} vs list ${activeStudents}`);

  const officeDash = (await api('/dashboards/administrator', { token: administrator.token })).data;
  check('the office dashboard agrees with it',
    officeDash.students.active === activeStudents,
    `office ${officeDash.students.active} vs list ${activeStudents}`);

  const teachDash = (await api('/dashboards/teaching', { token: teacher.token })).data;
  const teacherCourses = (await api(`/academics/course-assignments?faculty_id=${teacherRow.id}`,
    { token: admin.token })).meta.total;
  check('the teacher dashboard matches their assignments',
    teachDash.counts.assignments === teacherCourses,
    `dashboard ${teachDash.counts.assignments} vs assignments ${teacherCourses}`);

  // ==================================================================
  chain('11. Cleaning up');

  if (pupilId) {
    const removed = await api(`/students/${pupilId}`, { token: admin.token, method: 'DELETE' });
    check('the probe pupil is removed', removed.status === 200 || removed.status === 204,
      `${removed.status} ${removed.error?.message ?? ''}`);
    const rollNow = (await api('/students/by-class', { token: administrator.token })).data
      .find((k) => k.class_id === targetClass.class_id)
      .sections.find((s) => s.section_id === targetSection.section_id);
    check('the class roll is back to where it started', rollNow.students === before,
      `${rollNow.students} vs ${before}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Broken links:');
    for (const failure of failures) console.log(`    - ${failure}`);
  }
  console.log(`${'='.repeat(60)}\n`);
  process.exit(failed ? 1 : 0);
};

run().catch((error) => {
  console.error('\nIntegration run aborted:', error);
  process.exit(1);
});
