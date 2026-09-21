import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated, safeSort } from '../lib/http.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { optionalNumber, validateBody } from '../middleware/validate.js';
import { photoUpload, documentUpload, publicPath } from '../middleware/upload.js';
import { heavyLimiter } from '../middleware/ratelimit.js';
import { hashPassword } from '../lib/auth.js';
import { logActivity, diff } from '../lib/audit.js';
import { isAdmin, isStaff, facultyIdOf } from '../lib/scope.js';
import env from '../config/env.js';
import { facultyCodes } from '../lib/codes.js';

const router = Router();

const facultySchema = z.object({
  full_name: z.string().min(2).max(160),
  email: z.string().email('Enter a valid email address').max(160),
  username: z.string().min(3).max(60).optional(),
  password: z.string().min(8).max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  faculty_code: z.string().max(30).optional(),
  staff_type: z.enum(['TEACHING', 'FINANCIAL']),
  board: z.enum(['STATE', 'CBSE', 'BOTH']).optional(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  designation: z.string().max(80).optional().nullable(),
  qualification: z.string().max(160).optional().nullable(),
  specialization: z.string().max(160).optional().nullable(),
  experience_years: optionalNumber(0, 60),
  date_of_birth: z.string().max(20).optional().nullable(),
  date_of_joining: z.string().max(20).optional().nullable(),
  blood_group: z.string().max(6).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  emergency_contact: z.string().max(40).optional().nullable(),
  bank_account: z.string().max(40).optional().nullable(),
  pan_number: z.string().max(20).optional().nullable(),
  is_mentor: z.coerce.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED']).optional(),
});

const SELECT_FACULTY = `
  f.*, u.full_name, u.email, u.phone, u.photo, u.username, u.gender, u.status AS account_status,
  d.name AS department_name, r.code AS role_code,
  (SELECT COUNT(*) FROM course_assignments ca WHERE ca.faculty_id = f.id AND ca.status = 'ACTIVE') AS assigned_courses,
  (SELECT COUNT(*) FROM students s WHERE s.mentor_id = f.id AND s.status = 'ACTIVE') AS mentee_count`;

const JOIN_FACULTY = `
  JOIN users u ON u.id = f.user_id
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN departments d ON d.id = f.department_id`;

const roleForStaffType = (staffType) => (staffType === 'TEACHING' ? 'TEACHING_STAFF' : 'FINANCIAL_STAFF');

/**
 * The next free faculty code.
 *
 * Counting the rows and adding one was the old way, and it repeats a code as
 * soon as anyone is removed: twenty-three staff less one leaves 22, and the
 * next code offered is VFT0023 — which still belongs to someone. The allocator
 * counts from the highest number actually in use.
 */
async function nextFacultyCode(campusId, staffType) {
  return (await facultyCodes(campusId, staffType)).take();
}

// ------------------------------------------------------------------ list
router.get(
  '/',
  requirePermission('faculty.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'faculty_code', 'date_of_joining', 'created_at'], 'id');

    const clauses = [];
    const params = [];
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('f.campus_id = ?');
      params.push(req.user.campus_id);
    }
    for (const field of ['staff_type', 'department_id', 'status', 'is_mentor']) {
      const value = req.query[field];
      if (value !== undefined && value !== '' && value !== 'ALL') {
        clauses.push(`f.${field} = ?`);
        params.push(value);
      }
    }
    // Filtering by department also returns staff who serve both wings.
    if (req.query.board && req.query.board !== 'ALL') {
      if (req.query.board === 'BOTH') {
        clauses.push("f.board = 'BOTH'");
      } else {
        clauses.push("(f.board = ? OR f.board = 'BOTH')");
        params.push(req.query.board);
      }
    }
    if (req.query.search) {
      const term = `%${req.query.search}%`;
      clauses.push('(u.full_name ILIKE ? OR f.faculty_code ILIKE ? OR u.email ILIKE ? OR f.designation ILIKE ?)');
      params.push(term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM faculty f JOIN users u ON u.id = f.user_id ${where}`, params));
    const rows = await all(
      `SELECT ${SELECT_FACULTY} FROM faculty f ${JOIN_FACULTY} ${where}
        ORDER BY f.${column} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginated(res, rows, total, { page, limit });
  })
);

// ---------------------------------------------------------------- detail
router.get(
  '/:id',
  requirePermission('faculty.view'),
  asyncHandler(async (req, res) => {
    const row = await get(`SELECT ${SELECT_FACULTY} FROM faculty f ${JOIN_FACULTY} WHERE f.id = ?`, [Number(req.params.id)]);
    if (!row) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && row.campus_id !== req.user.campus_id) throw forbidden('Different campus');
    return ok(res, row);
  })
);

/** Full faculty profile: assignments, attendance, leave, documents, salary. */
router.get(
  '/:id/profile',
  requirePermission('faculty.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const faculty = await get(`SELECT ${SELECT_FACULTY} FROM faculty f ${JOIN_FACULTY} WHERE f.id = ?`, [id]);
    if (!faculty) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && faculty.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const assignments = await all(
      `SELECT ca.id, co.code AS course_code, co.name AS course_name, sub.name AS subject_name,
              c.name AS class_name, sec.name AS section_name, ca.status
         FROM course_assignments ca
         JOIN courses co ON co.id = ca.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         JOIN sections sec ON sec.id = ca.section_id
         JOIN classes c ON c.id = sec.class_id
        WHERE ca.faculty_id = ? ORDER BY c.name, sec.name`,
      [id]
    );

    const attendance = await get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'ABSENT'  THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN status = 'LEAVE'   THEN 1 ELSE 0 END) AS leave_count
         FROM faculty_attendance WHERE faculty_id = ?`,
      [id]
    );

    const leaves = await all(
      `SELECT * FROM leave_requests WHERE requester_type = 'FACULTY' AND faculty_id = ?
        ORDER BY created_at DESC LIMIT 20`,
      [id]
    );

    const documents = await all(`SELECT * FROM documents WHERE owner_type = 'FACULTY' AND owner_id = ? ORDER BY created_at DESC`, [id]);

    const mentees = await all(
      `SELECT s.id, s.admission_number, s.first_name, s.last_name, c.name AS class_name, sec.name AS section_name
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE s.mentor_id = ? AND s.status = 'ACTIVE'`,
      [id]
    );

    const timetable = await all(
      `SELECT t.*, co.name AS course_name, c.name AS class_name, sec.name AS section_name
         FROM timetables t
         LEFT JOIN courses co ON co.id = t.course_id
         LEFT JOIN sections sec ON sec.id = t.section_id
         LEFT JOIN classes c ON c.id = t.class_id
        WHERE t.faculty_id = ? ORDER BY t.day_of_week, t.period`,
      [id]
    );

    // Salary is visible to Admin, payroll-permitted staff, or the person themselves.
    const isSelf = await facultyIdOf(req.user) === id;
    const canSeeSalary = isAdmin(req.user) || req.permissions.has('payroll.view') || isSelf;
    const salary = canSeeSalary
      ? {
          structure: await get(`SELECT * FROM salary_structures WHERE user_id = ? AND status = 'ACTIVE' ORDER BY effective_from DESC LIMIT 1`, [
            faculty.user_id,
          ]),
          recent: await all(`SELECT * FROM payroll WHERE user_id = ? ORDER BY year DESC, month DESC LIMIT 12`, [faculty.user_id]),
        }
      : null;

    const activity = isStaff(req.user)
      ? await all(
          `SELECT action, module, description, user_name, created_at FROM activity_logs
            WHERE entity_type = 'Faculty' AND entity_id = ? ORDER BY created_at DESC LIMIT 20`,
          [id]
        )
      : [];

    return ok(res, { faculty, assignments, attendance, leaves, documents, mentees, timetable, salary, activity });
  })
);

// --------------------------------------------------------------- create
router.post(
  '/',
  requirePermission('faculty.create'),
  validateBody(facultySchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const campusId = isAdmin(req.user) && req.body.campus_id ? Number(req.body.campus_id) : req.user.campus_id;
    if (!campusId) throw badRequest('No campus is associated with your account');

    const roleCode = roleForStaffType(body.staff_type);
    const role = await get('SELECT id FROM roles WHERE code = ?', [roleCode]);
    if (!role) throw badRequest('Role configuration missing');

    const facultyCode = body.faculty_code || await nextFacultyCode(campusId, body.staff_type);
    const username = body.username || facultyCode.toLowerCase();

    if (await get('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)', [username])) throw conflict('That username is taken');
    if (await get('SELECT 1 AS x FROM users WHERE lower(email) = lower(?)', [body.email])) throw conflict('That email is registered');
    if (await get('SELECT 1 AS x FROM faculty WHERE faculty_code = ?', [facultyCode])) throw conflict('That faculty code exists');

    const password = body.password || env.seedPassword;
    const passwordHash = await hashPassword(password);

    const result = await transaction(async () => {
      const userId = await insert('users', {
        username,
        email: body.email,
        password_hash: passwordHash,
        full_name: body.full_name,
        phone: body.phone,
        gender: body.gender,
        role_id: role.id,
        campus_id: campusId,
        status: 'ACTIVE',
        must_change_password: body.password ? 0 : 1,
        created_by: req.user.id,
      });
      const facultyId = await insert('faculty', {
        user_id: userId,
        campus_id: campusId,
        faculty_code: facultyCode,
        staff_type: body.staff_type,
        board: body.board || 'BOTH',
        department_id: body.department_id,
        designation: body.designation,
        qualification: body.qualification,
        specialization: body.specialization,
        experience_years: body.experience_years ?? 0,
        date_of_birth: body.date_of_birth,
        date_of_joining: body.date_of_joining || new Date().toISOString().slice(0, 10),
        blood_group: body.blood_group,
        address: body.address,
        emergency_contact: body.emergency_contact,
        bank_account: body.bank_account,
        pan_number: body.pan_number,
        is_mentor: body.is_mentor ? 1 : 0,
        status: body.status || 'ACTIVE',
      });
      return { userId, facultyId };
    })();

    await logActivity({
      req,
      action: 'CREATE',
      module: 'faculty',
      entityType: 'Faculty',
      entityId: result.facultyId,
      description: `Created ${body.staff_type} staff ${body.full_name} (${facultyCode})`,
      newValues: { faculty_code: facultyCode, staff_type: body.staff_type, role: roleCode },
    });

    const row = await get(`SELECT ${SELECT_FACULTY} FROM faculty f ${JOIN_FACULTY} WHERE f.id = ?`, [result.facultyId]);
    return created(res, { ...row, temporaryPassword: body.password ? undefined : password });
  })
);

// --------------------------------------------------------------- update
router.put(
  '/:id',
  requirePermission('faculty.edit'),
  validateBody(facultySchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM faculty WHERE id = ?', [id]);
    if (!existing) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && existing.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const facultyFields = [
      'board', 'department_id', 'designation', 'qualification', 'specialization', 'experience_years',
      'date_of_birth', 'date_of_joining', 'blood_group', 'address', 'emergency_contact',
      'bank_account', 'pan_number', 'status',
    ];
    const data = {};
    for (const f of facultyFields) if (req.body[f] !== undefined) data[f] = req.body[f];
    if (req.body.is_mentor !== undefined) data.is_mentor = req.body.is_mentor ? 1 : 0;

    // Changing category also changes the login role — they must stay in step.
    if (req.body.staff_type && req.body.staff_type !== existing.staff_type) {
      const role = await get('SELECT id FROM roles WHERE code = ?', [roleForStaffType(req.body.staff_type)]);
      data.staff_type = req.body.staff_type;
      await update('users', existing.user_id, { role_id: role.id });
      await logActivity({
        req,
        action: 'ROLE_CHANGE',
        module: 'faculty',
        entityType: 'Faculty',
        entityId: id,
        description: `Moved ${existing.faculty_code} from ${existing.staff_type} to ${req.body.staff_type}`,
        oldValues: { staff_type: existing.staff_type },
        newValues: { staff_type: req.body.staff_type },
      });
    }

    if (Object.keys(data).length) await update('faculty', id, data);

    const userData = {};
    for (const f of ['full_name', 'email', 'phone', 'gender']) if (req.body[f] !== undefined) userData[f] = req.body[f];
    if (Object.keys(userData).length) await update('users', existing.user_id, userData);

    const changes = diff(existing, { ...existing, ...data });
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'faculty',
      entityType: 'Faculty',
      entityId: id,
      description: `Updated faculty ${existing.faculty_code}`,
      oldValues: changes.old,
      newValues: { ...changes.new, ...userData },
    });

    return ok(res, await get(`SELECT ${SELECT_FACULTY} FROM faculty f ${JOIN_FACULTY} WHERE f.id = ?`, [id]));
  })
);

router.post(
  '/:id/photo',
  requirePermission('faculty.edit'),
  heavyLimiter,
  photoUpload.single('photo'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const faculty = await get('SELECT * FROM faculty WHERE id = ?', [id]);
    if (!faculty) throw notFound('Faculty member not found');
    if (!req.file) throw badRequest('No photo was uploaded');
    const path = await publicPath(req.file, 'photos');
    await update('users', faculty.user_id, { photo: path });
    await logActivity({ req, action: 'UPDATE', module: 'faculty', entityType: 'Faculty', entityId: id, description: 'Updated photo' });
    return ok(res, { id, photo: path });
  })
);

router.post(
  '/:id/documents',
  requirePermission('documents.create', 'faculty.edit'),
  heavyLimiter,
  documentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const faculty = await get('SELECT * FROM faculty WHERE id = ?', [id]);
    if (!faculty) throw notFound('Faculty member not found');
    if (!req.file) throw badRequest('No file was uploaded');

    const docId = await insert('documents', {
      campus_id: faculty.campus_id,
      owner_type: 'FACULTY',
      owner_id: id,
      title: req.body.title || req.file.originalname,
      document_type: req.body.document_type || 'GENERAL',
      file_path: await publicPath(req.file, 'documents'),
      file_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_by: req.user.id,
    });
    return created(res, await get('SELECT * FROM documents WHERE id = ?', [docId]));
  })
);

router.delete(
  '/:id',
  requirePermission('faculty.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const faculty = await get('SELECT * FROM faculty WHERE id = ?', [id]);
    if (!faculty) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && faculty.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const assigned = Number(await scalar(`SELECT COUNT(*) AS n FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE'`, [id]));
    if (assigned) throw badRequest(`Reassign ${assigned} active course assignment(s) before deleting this member`);

    await run('DELETE FROM faculty WHERE id = ?', [id]);
    await run('DELETE FROM users WHERE id = ?', [faculty.user_id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'faculty',
      entityType: 'Faculty',
      entityId: id,
      description: `Deleted faculty ${faculty.faculty_code}`,
      oldValues: faculty,
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
