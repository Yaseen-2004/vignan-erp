import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated, safeSort } from '../lib/http.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { hashPassword } from '../lib/auth.js';
import { logActivity, diff } from '../lib/audit.js';
import { isAdmin } from '../lib/scope.js';
import { ROLES } from '../lib/permissions.js';
import env from '../config/env.js';
import { employeeCodes } from '../lib/codes.js';

const router = Router();

const administratorSchema = z.object({
  full_name: z.string().min(2).max(160),
  email: z.string().email('Enter a valid email address').max(160),
  username: z.string().min(3).max(60).optional(),
  password: z.string().min(8).max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  employee_code: z.string().max(30).optional(),
  designation: z.string().max(80).optional().nullable(),
  /**
   * The department this administrator may work in. Only an Admin reaches this
   * router at all, so only an Admin can set it; the scoping layer reads it on
   * every request, so a change takes effect on the administrator's next call
   * without them signing in again.
   */
  board: z.enum(['STATE', 'CBSE', 'BOTH']).optional(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  date_of_joining: z.string().max(20).optional().nullable(),
  qualification: z.string().max(160).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  emergency_contact: z.string().max(40).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  campus_id: z.coerce.number().int().positive().optional(),
  /** Permission codes granted on top of the ADMINISTRATOR role defaults. */
  allow_permissions: z.array(z.string()).optional(),
  /** Permission codes withheld from this administrator. */
  deny_permissions: z.array(z.string()).optional(),
});

const SELECT_ADMIN = `
  a.*, u.full_name, u.email, u.phone, u.photo, u.username, u.gender, u.status AS account_status,
  u.last_login_at, d.name AS department_name,
  (SELECT COUNT(*) FROM user_permissions up WHERE up.user_id = a.user_id AND up.effect = 'ALLOW') AS extra_permissions,
  (SELECT COUNT(*) FROM user_permissions up WHERE up.user_id = a.user_id AND up.effect = 'DENY') AS revoked_permissions`;

const JOIN_ADMIN = `
  JOIN users u ON u.id = a.user_id
  LEFT JOIN departments d ON d.id = a.department_id`;

/** The next free employee code, counted from the highest in use. */
async function nextEmployeeCode(campusId) {
  return (await employeeCodes(campusId)).take();
}

/** Apply per-user permission overrides for an administrator. */
async function applyOverrides(userId, allow = [], deny = [], grantedBy) {
  await run('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
  for (const [effect, codes] of [
    ['ALLOW', allow],
    ['DENY', deny],
  ]) {
    for (const code of codes) {
      const permission = await get('SELECT id FROM permissions WHERE code = ?', [code]);
      if (!permission) continue;
      await run('INSERT INTO user_permissions (user_id, permission_id, effect, granted_by) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, permission_id) DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by', [
        userId,
        permission.id,
        effect,
        grantedBy,
      ]);
    }
  }
}

router.get(
  '/',
  requirePermission('administrators.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'employee_code', 'date_of_joining', 'created_at'], 'id');

    const clauses = [];
    const params = [];
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('a.campus_id = ?');
      params.push(req.user.campus_id);
    }
    for (const field of ['status', 'department_id']) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        clauses.push(`a.${field} = ?`);
        params.push(req.query[field]);
      }
    }
    if (req.query.search) {
      const term = `%${req.query.search}%`;
      clauses.push('(u.full_name ILIKE ? OR a.employee_code ILIKE ? OR u.email ILIKE ? OR a.designation ILIKE ?)');
      params.push(term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM administrators a JOIN users u ON u.id = a.user_id ${where}`, params));
    const rows = await all(
      `SELECT ${SELECT_ADMIN} FROM administrators a ${JOIN_ADMIN} ${where}
        ORDER BY a.${column} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginated(res, rows, total, { page, limit });
  })
);

router.get(
  '/:id',
  requirePermission('administrators.view'),
  asyncHandler(async (req, res) => {
    const row = await get(`SELECT ${SELECT_ADMIN} FROM administrators a ${JOIN_ADMIN} WHERE a.id = ?`, [Number(req.params.id)]);
    if (!row) throw notFound('Administrator not found');
    if (!isAdmin(req.user) && row.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const overrides = await all(
      `SELECT p.code, p.module, p.action, up.effect
         FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ? ORDER BY p.code`,
      [row.user_id]
    );
    const rolePermissions = (await all(
      `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = rp.role_id
        WHERE r.code = 'ADMINISTRATOR'`
    )).map((r) => r.code);

    return ok(res, { ...row, overrides, rolePermissions });
  })
);

/** Only the Admin creates Administrator accounts and sets their permissions. */
router.post(
  '/',
  requireRole(ROLES.ADMIN),
  requirePermission('administrators.create'),
  validateBody(administratorSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const campusId = body.campus_id || req.user.campus_id;
    if (!campusId) throw badRequest('Select a campus for this administrator');

    const role = await get("SELECT id FROM roles WHERE code = 'ADMINISTRATOR'");
    const employeeCode = body.employee_code || await nextEmployeeCode(campusId);
    const username = body.username || employeeCode.toLowerCase();

    if (await get('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)', [username])) throw conflict('That username is taken');
    if (await get('SELECT 1 AS x FROM users WHERE lower(email) = lower(?)', [body.email])) throw conflict('That email is registered');
    if (await get('SELECT 1 AS x FROM administrators WHERE employee_code = ?', [employeeCode])) throw conflict('That employee code exists');

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
        status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        must_change_password: body.password ? 0 : 1,
        created_by: req.user.id,
      });
      const adminId = await insert('administrators', {
        user_id: userId,
        campus_id: campusId,
        employee_code: employeeCode,
        designation: body.designation || 'Administrator',
        board: body.board || 'BOTH',
        department_id: body.department_id,
        date_of_joining: body.date_of_joining || new Date().toISOString().slice(0, 10),
        qualification: body.qualification,
        address: body.address,
        emergency_contact: body.emergency_contact,
        status: body.status || 'ACTIVE',
      });
      if (body.allow_permissions?.length || body.deny_permissions?.length) {
        await applyOverrides(userId, body.allow_permissions || [], body.deny_permissions || [], req.user.id);
      }
      return { userId, adminId };
    })();

    await logActivity({
      req,
      action: 'CREATE',
      module: 'administrators',
      entityType: 'Administrator',
      entityId: result.adminId,
      description: `Created Administrator ${body.full_name} (${employeeCode})`,
      newValues: {
        employee_code: employeeCode,
        allow_permissions: body.allow_permissions || [],
        deny_permissions: body.deny_permissions || [],
      },
    });

    const row = await get(`SELECT ${SELECT_ADMIN} FROM administrators a ${JOIN_ADMIN} WHERE a.id = ?`, [result.adminId]);
    return created(res, { ...row, temporaryPassword: body.password ? undefined : password });
  })
);

router.put(
  '/:id',
  requireRole(ROLES.ADMIN),
  requirePermission('administrators.edit'),
  validateBody(administratorSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM administrators WHERE id = ?', [id]);
    if (!existing) throw notFound('Administrator not found');

    const data = {};
    for (const f of ['designation', 'board', 'department_id', 'date_of_joining', 'qualification', 'address', 'emergency_contact', 'status']) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (Object.keys(data).length) await update('administrators', id, data);

    const userData = {};
    for (const f of ['full_name', 'email', 'phone', 'gender']) if (req.body[f] !== undefined) userData[f] = req.body[f];
    if (req.body.status) userData.status = req.body.status;
    if (Object.keys(userData).length) await update('users', existing.user_id, userData);

    const changes = diff(existing, { ...existing, ...data });
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'administrators',
      entityType: 'Administrator',
      entityId: id,
      description: `Updated Administrator ${existing.employee_code}`,
      oldValues: changes.old,
      newValues: { ...changes.new, ...userData },
    });

    return ok(res, await get(`SELECT ${SELECT_ADMIN} FROM administrators a ${JOIN_ADMIN} WHERE a.id = ?`, [id]));
  })
);

/** Assign an Administrator's permissions — Admin only, fully audited. */
router.put(
  '/:id/permissions',
  requireRole(ROLES.ADMIN),
  requirePermission('roles.manage'),
  validateBody(
    z.object({
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const administrator = await get(`SELECT a.*, u.full_name FROM administrators a JOIN users u ON u.id = a.user_id WHERE a.id = ?`, [id]);
    if (!administrator) throw notFound('Administrator not found');

    const before = await all(
      `SELECT p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?`,
      [administrator.user_id]
    );

    await transaction(async () => await applyOverrides(administrator.user_id, req.body.allow, req.body.deny, req.user.id))();

    await logActivity({
      req,
      action: 'PERMISSION_CHANGE',
      module: 'administrators',
      entityType: 'Administrator',
      entityId: id,
      description: `Changed Administrator Permission for ${administrator.full_name}`,
      oldValues: before,
      newValues: { allow: req.body.allow, deny: req.body.deny },
    });

    return ok(res, { id, allow: req.body.allow, deny: req.body.deny });
  })
);

router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  requirePermission('administrators.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM administrators WHERE id = ?', [id]);
    if (!existing) throw notFound('Administrator not found');

    await run('DELETE FROM administrators WHERE id = ?', [id]);
    await run('DELETE FROM users WHERE id = ?', [existing.user_id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'administrators',
      entityType: 'Administrator',
      entityId: id,
      description: `Deleted Administrator ${existing.employee_code}`,
      oldValues: existing,
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
