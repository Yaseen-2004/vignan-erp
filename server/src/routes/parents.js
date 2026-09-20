import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated, safeSort } from '../lib/http.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { hashPassword } from '../lib/auth.js';
import { logActivity, diff } from '../lib/audit.js';
import { isAdmin, isParent, parentIdOf } from '../lib/scope.js';
import env from '../config/env.js';
import { parentCodes } from '../lib/codes.js';

const router = Router();

const parentSchema = z.object({
  father_name: z.string().max(120).optional().nullable(),
  father_occupation: z.string().max(80).optional().nullable(),
  father_phone: z.string().max(20).optional().nullable(),
  mother_name: z.string().max(120).optional().nullable(),
  mother_occupation: z.string().max(80).optional().nullable(),
  mother_phone: z.string().max(20).optional().nullable(),
  guardian_name: z.string().max(120).optional().nullable(),
  relation: z.string().max(20).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal('')),
  phone: z.string().max(20).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  annual_income: z.coerce.number().min(0).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  create_account: z.boolean().optional(),
  username: z.string().max(60).optional(),
  password: z.string().min(8).max(100).optional(),
  student_ids: z.array(z.coerce.number().int().positive()).optional(),
});

const SELECT_PARENT = `
  p.*, u.username, u.full_name, u.status AS account_status, u.last_login_at, u.photo,
  (SELECT COUNT(*) FROM student_parents sp WHERE sp.parent_id = p.id) AS children_count`;

const JOIN_PARENT = `LEFT JOIN users u ON u.id = p.user_id`;

router.get(
  '/',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'parent_code', 'created_at'], 'id');

    const clauses = [];
    const params = [];
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('p.campus_id = ?');
      params.push(req.user.campus_id);
    }
    // A parent may only ever read their own record.
    if (isParent(req.user)) {
      clauses.push('p.id = ?');
      params.push(await parentIdOf(req.user) ?? 0);
    }
    if (req.query.status && req.query.status !== 'ALL') {
      clauses.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.search) {
      const term = `%${req.query.search}%`;
      clauses.push('(p.father_name ILIKE ? OR p.mother_name ILIKE ? OR p.phone ILIKE ? OR p.parent_code ILIKE ? OR p.email ILIKE ?)');
      params.push(term, term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM parents p ${where}`, params));
    const rows = await all(
      `SELECT ${SELECT_PARENT} FROM parents p ${JOIN_PARENT} ${where}
        ORDER BY p.${column} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Attach the children so the list can show "Child 1 — 8A, Child 2 — 5B".
    for (const row of rows) {
      row.children = await all(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number, c.name AS class_name, sec.name AS section_name
           FROM student_parents sp
           JOIN students s ON s.id = sp.student_id
           LEFT JOIN classes c ON c.id = s.class_id
           LEFT JOIN sections sec ON sec.id = s.section_id
          WHERE sp.parent_id = ?`,
        [row.id]
      );
    }
    return paginated(res, rows, total, { page, limit });
  })
);

router.get(
  '/:id',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (isParent(req.user) && await parentIdOf(req.user) !== id) throw forbidden('You may only view your own record');

    const parent = await get(`SELECT ${SELECT_PARENT} FROM parents p ${JOIN_PARENT} WHERE p.id = ?`, [id]);
    if (!parent) throw notFound('Parent not found');
    if (!isAdmin(req.user) && !isParent(req.user) && parent.campus_id !== req.user.campus_id) {
      throw forbidden('Different campus');
    }

    parent.children = await all(
      `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.photo, s.status,
              c.name AS class_name, sec.name AS section_name, sp.relation, sp.is_primary
         FROM student_parents sp
         JOIN students s ON s.id = sp.student_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE sp.parent_id = ?`,
      [id]
    );
    return ok(res, parent);
  })
);

router.post(
  '/',
  requirePermission('parents.create'),
  validateBody(parentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const campusId = isAdmin(req.user) && req.body.campus_id ? Number(req.body.campus_id) : req.user.campus_id;
    if (!campusId) throw badRequest('No campus is associated with your account');

    // A truncated timestamp repeats about every 27 hours, and two parents
    // added in the same millisecond collide outright.
    const parentCode = (await parentCodes(campusId)).take();
    const username = body.username || parentCode.toLowerCase();
    if (body.create_account && await get('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)', [username])) {
      throw conflict('That username is taken');
    }

    const password = body.password || env.seedPassword;
    const passwordHash = body.create_account ? await hashPassword(password) : null;

    const result = await transaction(async () => {
      let userId = null;
      if (body.create_account) {
        const role = await get("SELECT id FROM roles WHERE code = 'PARENT'");
        userId = await insert('users', {
          username,
          email: body.email || `${username}@parent.vignan.edu`,
          password_hash: passwordHash,
          full_name: body.father_name || body.mother_name || body.guardian_name || 'Parent',
          phone: body.phone || body.father_phone || body.mother_phone,
          role_id: role.id,
          campus_id: campusId,
          status: 'ACTIVE',
          must_change_password: body.password ? 0 : 1,
          created_by: req.user.id,
        });
      }

      const parentId = await insert('parents', {
        user_id: userId,
        campus_id: campusId,
        parent_code: parentCode,
        father_name: body.father_name,
        father_occupation: body.father_occupation,
        father_phone: body.father_phone,
        mother_name: body.mother_name,
        mother_occupation: body.mother_occupation,
        mother_phone: body.mother_phone,
        guardian_name: body.guardian_name,
        relation: body.relation || 'FATHER',
        email: body.email || null,
        phone: body.phone,
        address: body.address,
        annual_income: body.annual_income,
        status: body.status || 'ACTIVE',
      });

      for (const studentId of body.student_ids || []) {
        await run('INSERT INTO student_parents (student_id, parent_id, relation, is_primary) VALUES (?, ?, ?, 1) ON CONFLICT DO NOTHING', [
          studentId,
          parentId,
          body.relation || 'FATHER',
        ]);
      }
      return { parentId, userId };
    })();

    await logActivity({
      req,
      action: 'CREATE',
      module: 'parents',
      entityType: 'Parent',
      entityId: result.parentId,
      description: `Created parent record ${parentCode}`,
      newValues: { parent_code: parentCode, children: body.student_ids || [] },
    });

    const row = await get(`SELECT ${SELECT_PARENT} FROM parents p ${JOIN_PARENT} WHERE p.id = ?`, [result.parentId]);
    return created(res, { ...row, temporaryPassword: body.create_account && !body.password ? password : undefined });
  })
);

router.put(
  '/:id',
  requirePermission('parents.edit'),
  validateBody(parentSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM parents WHERE id = ?', [id]);
    if (!existing) throw notFound('Parent not found');
    if (!isAdmin(req.user) && existing.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const data = {};
    for (const f of [
      'father_name', 'father_occupation', 'father_phone', 'mother_name', 'mother_occupation',
      'mother_phone', 'guardian_name', 'relation', 'email', 'phone', 'address', 'annual_income', 'status',
    ]) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (Object.keys(data).length) await update('parents', id, data);
    if (existing.user_id && (data.father_name || data.phone)) {
      await update('users', existing.user_id, {
        full_name: data.father_name ?? existing.father_name ?? undefined,
        phone: data.phone ?? undefined,
      });
    }

    const changes = diff(existing, { ...existing, ...data });
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'parents',
      entityType: 'Parent',
      entityId: id,
      description: `Updated parent ${existing.parent_code}`,
      oldValues: changes.old,
      newValues: changes.new,
    });
    return ok(res, await get(`SELECT ${SELECT_PARENT} FROM parents p ${JOIN_PARENT} WHERE p.id = ?`, [id]));
  })
);

/** Link a child to a parent account — the basis of multi-child support. */
router.post(
  '/:id/children',
  requirePermission('parents.edit'),
  validateBody(
    z.object({
      student_id: z.coerce.number().int().positive(),
      relation: z.string().max(20).default('FATHER'),
      is_primary: z.coerce.boolean().default(true),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parent = await get('SELECT * FROM parents WHERE id = ?', [id]);
    if (!parent) throw notFound('Parent not found');
    const student = await get('SELECT * FROM students WHERE id = ?', [req.body.student_id]);
    if (!student) throw notFound('Student not found');
    if (student.campus_id !== parent.campus_id) throw badRequest('Student and parent belong to different campuses');

    await run('INSERT INTO student_parents (student_id, parent_id, relation, is_primary) VALUES (?, ?, ?, ?) ON CONFLICT (student_id, parent_id) DO UPDATE SET relation = EXCLUDED.relation, is_primary = EXCLUDED.is_primary', [
      student.id,
      id,
      req.body.relation,
      req.body.is_primary ? 1 : 0,
    ]);

    await logActivity({
      req,
      action: 'UPDATE',
      module: 'parents',
      entityType: 'Parent',
      entityId: id,
      description: `Linked student ${student.admission_number} to parent ${parent.parent_code}`,
      newValues: { student_id: student.id, relation: req.body.relation },
    });
    return created(res, { parent_id: id, student_id: student.id });
  })
);

router.delete(
  '/:id/children/:studentId',
  requirePermission('parents.edit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const studentId = Number(req.params.studentId);
    const parent = await get('SELECT * FROM parents WHERE id = ?', [id]);
    if (!parent) throw notFound('Parent not found');

    await run('DELETE FROM student_parents WHERE parent_id = ? AND student_id = ?', [id, studentId]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'parents',
      entityType: 'Parent',
      entityId: id,
      description: `Unlinked student #${studentId} from parent ${parent.parent_code}`,
    });
    return ok(res, { parent_id: id, student_id: studentId, unlinked: true });
  })
);

router.delete(
  '/:id',
  requirePermission('parents.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parent = await get('SELECT * FROM parents WHERE id = ?', [id]);
    if (!parent) throw notFound('Parent not found');
    if (!isAdmin(req.user) && parent.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    await run('DELETE FROM parents WHERE id = ?', [id]);
    if (parent.user_id) await run('DELETE FROM users WHERE id = ?', [parent.user_id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'parents',
      entityType: 'Parent',
      entityId: id,
      description: `Deleted parent ${parent.parent_code}`,
      oldValues: parent,
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
