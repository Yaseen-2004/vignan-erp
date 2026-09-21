import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated, safeSort } from '../lib/http.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { photoUpload, documentUpload, publicPath } from '../middleware/upload.js';
import { heavyLimiter } from '../middleware/ratelimit.js';
import { hashPassword } from '../lib/auth.js';
import { logActivity, diff } from '../lib/audit.js';
import {
  accessibleStudentIds, assertStudentAccess, isAdmin, isStaff, isTeacher,
  hasFullStudentAccess, facultyIdOf,
} from '../lib/scope.js';
import { notify } from '../lib/notify.js';
import env from '../config/env.js';
import { parentCodes } from '../lib/codes.js';

const router = Router();

const studentSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(80),
  last_name: z.string().max(80).optional().nullable(),
  admission_number: z.string().min(1).max(40).optional(),
  roll_number: z.string().max(20).optional().nullable(),
  date_of_birth: z.string().max(20).optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  blood_group: z.string().max(6).optional().nullable(),
  class_id: z.coerce.number().int().positive().optional().nullable(),
  section_id: z.coerce.number().int().positive().optional().nullable(),
  academic_year_id: z.coerce.number().int().positive().optional().nullable(),
  board: z.enum(['STATE', 'CBSE']).optional(),
  mentor_id: z.coerce.number().int().positive().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal('')),
  address: z.string().max(400).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  state: z.string().max(80).optional().nullable(),
  pincode: z.string().max(10).optional().nullable(),
  religion: z.string().max(40).optional().nullable(),
  category: z.string().max(40).optional().nullable(),
  aadhaar_number: z.string().max(20).optional().nullable(),
  previous_school: z.string().max(160).optional().nullable(),
  admission_date: z.string().max(20).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALUMNI', 'TRANSFERRED', 'SUSPENDED']).optional(),
  // Optional account + parent creation performed in the same transaction.
  create_account: z.boolean().optional(),
  username: z.string().max(60).optional(),
  password: z.string().min(8).max(100).optional(),
  parent_id: z.coerce.number().int().positive().optional().nullable(),
  parent: z
    .object({
      father_name: z.string().max(120).optional(),
      mother_name: z.string().max(120).optional(),
      phone: z.string().max(20).optional(),
      email: z.string().email().max(160).optional().or(z.literal('')),
      relation: z.string().max(20).optional(),
      occupation: z.string().max(80).optional(),
      create_account: z.boolean().optional(),
    })
    .optional(),
});

const SELECT_STUDENT = `
  s.*, c.name AS class_name, sec.name AS section_name, ay.name AS academic_year_name,
  u.username, u.status AS account_status, u.email AS account_email,
  f.faculty_code AS mentor_code, mu.full_name AS mentor_name,
  (s.first_name || ' ' || COALESCE(s.last_name, '')) AS full_name`;

const JOIN_STUDENT = `
  LEFT JOIN classes c ON c.id = s.class_id
  LEFT JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN faculty f ON f.id = s.mentor_id
  LEFT JOIN users mu ON mu.id = f.user_id`;

/** A student belongs to the department (board) of the class they sit in. */
async function boardForClass(classId, fallback = 'STATE') {
  if (!classId) return fallback;
  const row = await get('SELECT board FROM classes WHERE id = ?', [Number(classId)]);
  return row?.board || fallback;
}

/** Next admission number for a campus, e.g. VGN2026-0042. */
async function nextAdmissionNumber(campusId) {
  const year = new Date().getFullYear();
  const prefix = `VGN${year}-`;
  const last = await scalar(
    `SELECT admission_number FROM students WHERE campus_id = ? AND admission_number ILIKE ? ORDER BY id DESC LIMIT 1`,
    [campusId, `${prefix}%`]
  );
  const next = last ? Number(String(last).split('-')[1]) + 1 : 1;
  return prefix + String(next).padStart(4, '0');
}

// ------------------------------------------------------------------ list
router.get(
  '/',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(
      req.query,
      ['id', 'first_name', 'admission_number', 'roll_number', 'created_at', 'admission_date'],
      'id'
    );

    const clauses = [];
    const params = [];

    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('s.campus_id = ?');
      params.push(req.user.campus_id);
    }

    // Ownership / assignment scoping.
    const allowed = await accessibleStudentIds(req.user);
    if (allowed !== null) {
      if (!allowed.length) return paginated(res, [], 0, { page, limit });
      clauses.push(`s.id IN (${allowed.map(() => '?').join(',')})`);
      params.push(...allowed);
    }

    for (const field of ['class_id', 'section_id', 'academic_year_id', 'status', 'mentor_id', 'gender', 'board']) {
      const value = req.query[field];
      if (value && value !== 'ALL') {
        clauses.push(`s.${field} = ?`);
        params.push(value);
      }
    }
    if (req.query.search) {
      const term = `%${req.query.search}%`;
      clauses.push('(s.first_name ILIKE ? OR s.last_name ILIKE ? OR s.admission_number ILIKE ? OR s.roll_number ILIKE ? OR s.phone ILIKE ?)');
      params.push(term, term, term, term, term);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM students s ${where}`, params));
    const rows = await all(
      `SELECT ${SELECT_STUDENT} FROM students s ${JOIN_STUDENT} ${where}
        ORDER BY s.${column} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginated(res, rows, total, { page, limit });
  })
);

/**
 * The same students, arranged class by class.
 *
 * The flat list is right when you know who you are looking for; this is right
 * when you are working through a class. It returns one row per section with a
 * head count, grouped under its class, and it honours exactly the same
 * ownership and assignment scoping as the list above — a teacher sees only
 * the sections assigned to them, and an Administrator only their campus.
 */
router.get(
  '/by-class',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const clauses = ["s.status = 'ACTIVE'"];
    const params = [];

    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('s.campus_id = ?');
      params.push(req.user.campus_id);
    }

    const allowed = await accessibleStudentIds(req.user);
    if (allowed !== null) {
      if (!allowed.length) return ok(res, []);
      clauses.push(`s.id IN (${allowed.map(() => '?').join(',')})`);
      params.push(...allowed);
    }

    for (const field of ['board', 'academic_year_id']) {
      const value = req.query[field];
      if (value && value !== 'ALL') {
        clauses.push(`s.${field} = ?`);
        params.push(value);
      }
    }

    const rows = await all(
      `SELECT c.id            AS class_id,
              c.name          AS class_name,
              c.numeric_level AS numeric_level,
              c.board         AS board,
              c.stream        AS stream,
              sec.id          AS section_id,
              sec.name        AS section_name,
              ct.full_name    AS class_teacher,
              COUNT(s.id)     AS students,
              SUM(CASE WHEN s.gender = 'MALE' THEN 1 ELSE 0 END)   AS boys,
              SUM(CASE WHEN s.gender = 'FEMALE' THEN 1 ELSE 0 END) AS girls
         FROM students s
         JOIN classes c        ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN faculty  cf  ON cf.id = c.class_teacher_id
         LEFT JOIN users    ct  ON ct.id = cf.user_id
        WHERE ${clauses.join(' AND ')}
        GROUP BY c.id, sec.id, ct.id
        ORDER BY c.board, c.numeric_level, sec.name`,
      params
    );

    // Fold the section rows up under their class.
    const classes = [];
    const index = new Map();
    for (const row of rows) {
      let entry = index.get(row.class_id);
      if (!entry) {
        entry = {
          class_id: row.class_id,
          class_name: row.class_name,
          numeric_level: row.numeric_level,
          board: row.board,
          stream: row.stream,
          class_teacher: row.class_teacher,
          students: 0,
          boys: 0,
          girls: 0,
          sections: [],
        };
        index.set(row.class_id, entry);
        classes.push(entry);
      }
      entry.students += Number(row.students) || 0;
      entry.boys += Number(row.boys) || 0;
      entry.girls += Number(row.girls) || 0;
      entry.sections.push({
        section_id: row.section_id,
        section_name: row.section_name,
        students: Number(row.students) || 0,
        boys: Number(row.boys) || 0,
        girls: Number(row.girls) || 0,
      });
    }

    return ok(res, classes);
  })
);

// ---------------------------------------------------------------- detail
router.get(
  '/:id',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    await assertStudentAccess(req.user, req.params.id);
    const student = await get(`SELECT ${SELECT_STUDENT} FROM students s ${JOIN_STUDENT} WHERE s.id = ?`, [
      Number(req.params.id),
    ]);
    return ok(res, student);
  })
);

/**
 * Student 360° profile — every panel the specification lists, in one call.
 */
router.get(
  '/:id/profile',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertStudentAccess(req.user, id);

    const student = await get(`SELECT ${SELECT_STUDENT} FROM students s ${JOIN_STUDENT} WHERE s.id = ?`, [id]);
    if (!student) throw notFound('Student not found');

    /**
     * A subject teacher gets their own subject's picture of this student; a
     * class teacher (or the student's mentor) gets the whole record. The
     * client is told which, so it can say so rather than silently hiding tabs.
     */
    const fullAccess = await hasFullStudentAccess(req.user, student);
    const subjectOnly = isTeacher(req.user) && !fullAccess;
    const facultyId = subjectOnly ? await facultyIdOf(req.user) : null;

    // The courses this teacher actually teaches to this student.
    const ownCourseIds = subjectOnly
      ? (await all(
          `SELECT DISTINCT course_id FROM course_assignments
            WHERE faculty_id = ? AND section_id = ? AND status = 'ACTIVE'`,
          [facultyId ?? 0, student.section_id]
        )).map((r) => r.course_id)
      : null;
    const ownCourseFilter = ownCourseIds?.length
      ? ` AND course_id IN (${ownCourseIds.map(() => '?').join(',')})`
      : ownCourseIds
        ? ' AND 1 = 0'
        : '';
    const ownCourseParams = ownCourseIds?.length ? ownCourseIds : [];

    const attendanceStats = await get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'ABSENT'  THEN 1 ELSE 0 END) AS absent
         FROM attendance WHERE student_id = ?${subjectOnly ? ownCourseFilter : ''}`,
      [id, ...(subjectOnly ? ownCourseParams : [])]
    );

    const courses = await all(
      `SELECT DISTINCT co.id, co.code, co.name, sub.name AS subject_name,
              fu.full_name AS faculty_name, c.name AS class_name, sec.name AS section_name
         FROM courses co
         JOIN subjects sub ON sub.id = co.subject_id
         LEFT JOIN course_assignments ca ON ca.course_id = co.id AND ca.section_id = ?
         LEFT JOIN faculty f ON f.id = ca.faculty_id
         LEFT JOIN users fu ON fu.id = f.user_id
         LEFT JOIN classes c ON c.id = co.class_id
         LEFT JOIN sections sec ON sec.id = ca.section_id
        WHERE co.class_id = ? AND co.status = 'ACTIVE'`,
      [student.section_id, student.class_id]
    );

    const results = await all(
      `SELECT r.*, e.name AS exam_name, e.exam_type
         FROM results r JOIN examinations e ON e.id = r.examination_id
        WHERE r.student_id = ? AND r.published = 1
        ORDER BY e.start_date DESC`,
      [id]
    );

    const fees = await get(
      `SELECT COALESCE(SUM(total_amount - discount_amount), 0) AS total,
              COALESCE(SUM(paid_amount), 0) AS paid,
              COALESCE(SUM(total_amount - discount_amount - paid_amount), 0) AS pending
         FROM student_fees WHERE student_id = ?`,
      [id]
    );

    const feeRows = await all(
      `SELECT sf.*, fs.name AS fee_name, fc.name AS category_name
         FROM student_fees sf
         JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         JOIN fee_categories fc ON fc.id = fs.fee_category_id
        WHERE sf.student_id = ? ORDER BY sf.due_date`,
      [id]
    );

    const parents = await all(
      `SELECT p.*, sp.relation, sp.is_primary, u.username, u.email AS account_email
         FROM student_parents sp
         JOIN parents p ON p.id = sp.parent_id
         LEFT JOIN users u ON u.id = p.user_id
        WHERE sp.student_id = ?`,
      [id]
    );

    const transport = await get(
      `SELECT ta.*, r.name AS route_name, r.route_code, v.vehicle_number, v.vehicle_type,
              d.name AS driver_name, d.phone AS driver_phone
         FROM transport_allocations ta
         JOIN routes r ON r.id = ta.route_id
         LEFT JOIN vehicles v ON v.id = COALESCE(ta.vehicle_id, r.vehicle_id)
         LEFT JOIN drivers d ON d.id = r.driver_id
        WHERE ta.student_id = ? AND ta.status = 'ACTIVE' LIMIT 1`,
      [id]
    );

    // Everything a student or parent needs in order to reach their mentor.
    const mentor = student.mentor_id
      ? await get(
          `SELECT f.id, f.faculty_code, f.designation, f.qualification, f.specialization,
                  f.experience_years, f.staff_type, f.board,
                  u.id AS user_id, u.full_name, u.email, u.phone, u.photo,
                  d.name AS department_name,
                  (SELECT COUNT(*) FROM students st WHERE st.mentor_id = f.id AND st.status = 'ACTIVE') AS mentee_count
             FROM faculty f
             JOIN users u ON u.id = f.user_id
             LEFT JOIN departments d ON d.id = f.department_id
            WHERE f.id = ?`,
          [student.mentor_id]
        )
      : null;

    // The classes the mentor teaches this student, useful context when writing.
    if (mentor) {
      mentor.teaches = await all(
        `SELECT DISTINCT sub.name AS subject_name, co.name AS course_name
           FROM course_assignments ca
           JOIN courses co ON co.id = ca.course_id
           JOIN subjects sub ON sub.id = co.subject_id
          WHERE ca.faculty_id = ? AND ca.section_id = ? AND ca.status = 'ACTIVE'`,
        [mentor.id, student.section_id]
      );
      const meetings = await all(
        `SELECT meeting_date FROM mentoring_records
          WHERE student_id = ? AND mentor_id = ? AND meeting_date IS NOT NULL
          ORDER BY meeting_date DESC LIMIT 1`,
        [id, mentor.id]
      );
      mentor.last_meeting = meetings[0]?.meeting_date ?? null;
    }

    const mentoring = await all(
      `SELECT mr.*, u.full_name AS mentor_name
         FROM mentoring_records mr
         LEFT JOIN faculty f ON f.id = mr.mentor_id
         LEFT JOIN users u ON u.id = f.user_id
        WHERE mr.student_id = ? ORDER BY mr.created_at DESC LIMIT 20`,
      [id]
    );

    const documents = await all(
      `SELECT id, title, document_type, file_path, file_name, file_size, verified, created_at
         FROM documents WHERE owner_type = 'STUDENT' AND owner_id = ? ORDER BY created_at DESC`,
      [id]
    );

    const leaves = await all(
      `SELECT * FROM leave_requests WHERE requester_type = 'STUDENT' AND student_id = ?
        ORDER BY created_at DESC LIMIT 20`,
      [id]
    );

    const enrollmentHistory = await all(
      `SELECT e.*, ay.name AS academic_year_name, c.name AS class_name, sec.name AS section_name
         FROM enrollments e
         JOIN academic_years ay ON ay.id = e.academic_year_id
         JOIN classes c ON c.id = e.class_id
         JOIN sections sec ON sec.id = e.section_id
        WHERE e.student_id = ? ORDER BY ay.start_date DESC`,
      [id]
    );

    // Activity history is staff-only — students and parents do not need it.
    const activity = isStaff(req.user)
      ? await all(
          `SELECT action, module, description, user_name, created_at
             FROM activity_logs WHERE entity_type = 'Student' AND entity_id = ?
            ORDER BY created_at DESC LIMIT 25`,
          [id]
        )
      : [];

    // A subject teacher's marks for this student, in their own courses only.
    const subjectMarks = subjectOnly
      ? await all(
          `SELECT m.marks_obtained, m.max_marks, m.grade, m.is_absent, m.status,
                  sub.name AS subject_name, co.name AS course_name, e.name AS exam_name
             FROM marks m
             JOIN courses co ON co.id = m.course_id
             JOIN subjects sub ON sub.id = co.subject_id
             JOIN examinations e ON e.id = m.examination_id
            WHERE m.student_id = ?${ownCourseFilter.replace('course_id', 'm.course_id')}
            ORDER BY e.start_date DESC`,
          [id, ...ownCourseParams]
        )
      : [];

    const total = Number(attendanceStats?.total || 0);
    return ok(res, {
      access: fullAccess ? 'FULL' : 'SUBJECT',
      subjectMarks,
      student,
      attendance: {
        ...attendanceStats,
        percentage: total ? Number((((attendanceStats.present || 0) / total) * 100).toFixed(2)) : 0,
      },
      courses: subjectOnly ? courses.filter((c) => ownCourseIds.includes(c.id)) : courses,
      // Whole-child records belong to the class teacher, not to every subject
      // teacher who happens to take this section.
      results: subjectOnly ? [] : results,
      fees: subjectOnly ? null : { summary: fees, rows: feeRows },
      parents,
      transport: subjectOnly ? null : transport,
      mentor: subjectOnly ? null : mentor,
      mentoring: subjectOnly ? [] : mentoring,
      documents: subjectOnly ? [] : documents,
      leaves: subjectOnly ? [] : leaves,
      enrollmentHistory: subjectOnly ? [] : enrollmentHistory,
      activity,
    });
  })
);

// ------------------------------------------------------- admission (create)
router.post(
  '/',
  requirePermission('students.create'),
  validateBody(studentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const campusId = isAdmin(req.user) && req.body.campus_id ? Number(req.body.campus_id) : req.user.campus_id;
    if (!campusId) throw badRequest('No campus is associated with your account');

    const admissionNumber = body.admission_number || await nextAdmissionNumber(campusId);
    if (await get('SELECT 1 AS x FROM students WHERE admission_number = ?', [admissionNumber])) {
      throw conflict('That admission number is already in use');
    }

    const password = body.password || env.seedPassword;
    const passwordHash = body.create_account ? await hashPassword(password) : null;
    const parentPasswordHash = body.parent?.create_account ? await hashPassword(password) : null;

    const result = await transaction(async () => {
      let userId = null;
      if (body.create_account) {
        const role = await get("SELECT id FROM roles WHERE code = 'STUDENT'");
        const username = body.username || admissionNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
        userId = await insert('users', {
          username,
          email: body.email || `${username}@student.vignan.edu`,
          password_hash: passwordHash,
          full_name: `${body.first_name} ${body.last_name || ''}`.trim(),
          phone: body.phone,
          gender: body.gender,
          role_id: role.id,
          campus_id: campusId,
          status: 'ACTIVE',
          must_change_password: body.password ? 0 : 1,
          created_by: req.user.id,
        });
      }

      const studentId = await insert('students', {
        user_id: userId,
        campus_id: campusId,
        admission_number: admissionNumber,
        roll_number: body.roll_number,
        first_name: body.first_name,
        last_name: body.last_name,
        date_of_birth: body.date_of_birth,
        gender: body.gender,
        blood_group: body.blood_group,
        class_id: body.class_id,
        section_id: body.section_id,
        academic_year_id: body.academic_year_id,
        board: await boardForClass(body.class_id, body.board),
        mentor_id: body.mentor_id,
        phone: body.phone,
        email: body.email || null,
        address: body.address,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        religion: body.religion,
        category: body.category,
        aadhaar_number: body.aadhaar_number,
        previous_school: body.previous_school,
        admission_date: body.admission_date || new Date().toISOString().slice(0, 10),
        status: body.status || 'ACTIVE',
      });

      // Enrolment record for the academic year (history is preserved per year).
      if (body.academic_year_id && body.class_id && body.section_id) {
        await run(
          `INSERT INTO enrollments (campus_id, student_id, academic_year_id, class_id, section_id, roll_number)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
          [campusId, studentId, body.academic_year_id, body.class_id, body.section_id, body.roll_number || null]
        );
      }

      // Link an existing parent, or create one from the inline block.
      let parentId = body.parent_id || null;
      if (!parentId && body.parent && (body.parent.father_name || body.parent.mother_name || body.parent.phone)) {
        let parentUserId = null;
        if (body.parent.create_account) {
          const parentRole = await get("SELECT id FROM roles WHERE code = 'PARENT'");
          const parentUsername = `p${admissionNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
          parentUserId = await insert('users', {
            username: parentUsername,
            email: body.parent.email || `${parentUsername}@parent.vignan.edu`,
            password_hash: parentPasswordHash,
            full_name: body.parent.father_name || body.parent.mother_name || 'Parent',
            phone: body.parent.phone,
            role_id: parentRole.id,
            campus_id: campusId,
            status: 'ACTIVE',
            must_change_password: 1,
            created_by: req.user.id,
          });
        }
        const parentCode = (await parentCodes(campusId)).take();
        parentId = await insert('parents', {
          user_id: parentUserId,
          campus_id: campusId,
          parent_code: parentCode,
          father_name: body.parent.father_name,
          mother_name: body.parent.mother_name,
          father_occupation: body.parent.occupation,
          phone: body.parent.phone,
          email: body.parent.email || null,
          relation: body.parent.relation || 'FATHER',
          address: body.address,
        });
      }
      if (parentId) {
        await run(
          `INSERT INTO student_parents (student_id, parent_id, relation, is_primary) VALUES (?, ?, ?, 1) ON CONFLICT DO NOTHING`,
          [studentId, parentId, body.parent?.relation || 'FATHER']
        );
      }

      return { studentId, userId, parentId };
    })();

    await logActivity({
      req,
      action: 'CREATE',
      module: 'students',
      entityType: 'Student',
      entityId: result.studentId,
      description: `Admitted student ${body.first_name} ${body.last_name || ''} (${admissionNumber})`,
      newValues: { admission_number: admissionNumber, class_id: body.class_id, section_id: body.section_id },
    });

    const student = await get(`SELECT ${SELECT_STUDENT} FROM students s ${JOIN_STUDENT} WHERE s.id = ?`, [result.studentId]);
    return created(res, {
      ...student,
      temporaryPassword: body.create_account && !body.password ? password : undefined,
    });
  })
);

// ---------------------------------------------------------------- update
router.put(
  '/:id',
  requirePermission('students.edit'),
  validateBody(studentSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await assertStudentAccess(req.user, id);

    const fields = [
      'first_name', 'last_name', 'roll_number', 'date_of_birth', 'gender', 'blood_group',
      'class_id', 'section_id', 'academic_year_id', 'mentor_id', 'phone', 'email', 'address',
      'city', 'state', 'pincode', 'religion', 'category', 'aadhaar_number', 'previous_school',
      'admission_date', 'status',
    ];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    if (!Object.keys(data).length) throw badRequest('No updatable fields supplied');

    // Moving a student to another class also moves them to that department.
    if (data.class_id !== undefined) data.board = await boardForClass(data.class_id, existing.board);
    else if (req.body.board) data.board = req.body.board;

    await update('students', id, data);

    // Keep the linked login in step with the profile.
    if (existing.user_id && (data.first_name || data.last_name || data.phone)) {
      await update('users', existing.user_id, {
        full_name: `${data.first_name ?? existing.first_name} ${data.last_name ?? existing.last_name ?? ''}`.trim(),
        phone: data.phone ?? existing.phone,
      });
    }

    const changes = diff(existing, { ...existing, ...data });
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'students',
      entityType: 'Student',
      entityId: id,
      description: `Updated student ${existing.admission_number}`,
      oldValues: changes.old,
      newValues: changes.new,
    });

    return ok(res, await get(`SELECT ${SELECT_STUDENT} FROM students s ${JOIN_STUDENT} WHERE s.id = ?`, [id]));
  })
);

/** Photo upload. */
router.post(
  '/:id/photo',
  requirePermission('students.edit'),
  heavyLimiter,
  photoUpload.single('photo'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await assertStudentAccess(req.user, id);
    if (!req.file) throw badRequest('No photo was uploaded');

    const path = await publicPath(req.file, 'photos');
    await update('students', id, { photo: path });
    if (student.user_id) await update('users', student.user_id, { photo: path });

    await logActivity({
      req,
      action: 'UPDATE',
      module: 'students',
      entityType: 'Student',
      entityId: id,
      description: 'Updated student photo',
    });
    return ok(res, { id, photo: path });
  })
);

/** Documents. */
router.get(
  '/:id/documents',
  requirePermission('documents.view', 'students.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertStudentAccess(req.user, id);
    return ok(res, await all(`SELECT * FROM documents WHERE owner_type = 'STUDENT' AND owner_id = ? ORDER BY created_at DESC`, [id]));
  })
);

router.post(
  '/:id/documents',
  requirePermission('documents.create', 'students.edit'),
  heavyLimiter,
  documentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await assertStudentAccess(req.user, id);
    if (!req.file) throw badRequest('No file was uploaded');

    const docId = await insert('documents', {
      campus_id: student.campus_id,
      owner_type: 'STUDENT',
      owner_id: id,
      title: req.body.title || req.file.originalname,
      document_type: req.body.document_type || 'GENERAL',
      file_path: await publicPath(req.file, 'documents'),
      file_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_by: req.user.id,
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'documents',
      entityType: 'Document',
      entityId: docId,
      description: `Uploaded document for student ${student.admission_number}`,
    });
    return created(res, await get('SELECT * FROM documents WHERE id = ?', [docId]));
  })
);

/**
 * Bulk promotion to the next class / academic year.
 * Previous enrolment rows are retained so history stays queryable.
 */
router.post(
  '/promote',
  requirePermission('enrollments.manage', 'students.manage'),
  validateBody(
    z.object({
      student_ids: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one student'),
      to_class_id: z.coerce.number().int().positive(),
      to_section_id: z.coerce.number().int().positive(),
      to_academic_year_id: z.coerce.number().int().positive(),
      remarks: z.string().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { student_ids, to_class_id, to_section_id, to_academic_year_id, remarks } = req.body;
    const campusId = req.user.campus_id;

    const promoted = await transaction(async () => {
      const done = [];
      for (const studentId of student_ids) {
        const student = await get('SELECT * FROM students WHERE id = ?', [studentId]);
        if (!student) continue;
        if (!isAdmin(req.user) && student.campus_id !== campusId) continue;

        await run(`UPDATE enrollments SET status = 'COMPLETED' WHERE student_id = ? AND status = 'ACTIVE'`, [studentId]);
        await run(
          `INSERT INTO enrollments
             (campus_id, student_id, academic_year_id, class_id, section_id, roll_number, promoted_from, status, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
          [
            student.campus_id,
            studentId,
            to_academic_year_id,
            to_class_id,
            to_section_id,
            student.roll_number,
            student.class_id,
            remarks || null,
          ]
        );
        await update('students', studentId, {
          class_id: to_class_id,
          section_id: to_section_id,
          academic_year_id: to_academic_year_id,
          board: await boardForClass(to_class_id, student.board),
        });
        if (student.user_id) {
          await notify({
            userId: student.user_id,
            campusId: student.campus_id,
            type: 'PROMOTION',
            title: 'You have been promoted',
            body: 'Your class and section have been updated for the new academic year.',
            link: '/parent/profile',
          });
        }
        done.push(studentId);
      }
      return done;
    })();

    await logActivity({
      req,
      action: 'PROMOTE',
      module: 'enrollments',
      entityType: 'Student',
      description: `Promoted ${promoted.length} student(s) to class #${to_class_id} section #${to_section_id}`,
      newValues: { student_ids: promoted, to_class_id, to_section_id, to_academic_year_id },
    });

    return ok(res, { promoted: promoted.length, student_ids: promoted });
  })
);

/** Generate an ID-card payload for printing. */
router.get(
  '/:id/id-card',
  requirePermission('students.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await assertStudentAccess(req.user, id);
    const student = await get(`SELECT ${SELECT_STUDENT} FROM students s ${JOIN_STUDENT} WHERE s.id = ?`, [id]);
    const campus = await get('SELECT name, address, city, phone, logo FROM campuses WHERE id = ?', [student.campus_id]);
    const transport = await get(
      `SELECT r.name AS route_name, ta.pickup_point FROM transport_allocations ta
         JOIN routes r ON r.id = ta.route_id WHERE ta.student_id = ? AND ta.status = 'ACTIVE' LIMIT 1`,
      [id]
    );
    return ok(res, { student, campus, transport });
  })
);

router.patch(
  '/:id/status',
  requirePermission('students.edit'),
  validateBody(z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'ALUMNI', 'TRANSFERRED', 'SUSPENDED']) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await assertStudentAccess(req.user, id);
    await update('students', id, { status: req.body.status });
    if (student.user_id) {
      await update('users', student.user_id, { status: req.body.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' });
    }
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'students',
      entityType: 'Student',
      entityId: id,
      description: `Set student ${student.admission_number} to ${req.body.status}`,
      oldValues: { status: student.status },
      newValues: { status: req.body.status },
    });
    return ok(res, { id, status: req.body.status });
  })
);

router.delete(
  '/:id',
  requirePermission('students.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await assertStudentAccess(req.user, id);
    await run('DELETE FROM students WHERE id = ?', [id]);
    if (student.user_id) await run('DELETE FROM users WHERE id = ?', [student.user_id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'students',
      entityType: 'Student',
      entityId: id,
      description: `Deleted student ${student.admission_number}`,
      oldValues: student,
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
