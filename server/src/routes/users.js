import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated, safeSort } from '../lib/http.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { hashPassword, revokeAllUserTokens } from '../lib/auth.js';
import { logActivity, diff } from '../lib/audit.js';
import { isAdmin } from '../lib/scope.js';
import { ROLES } from '../lib/permissions.js';
import env from '../config/env.js';

const router = Router();

const userSchema = z.object({
  username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, underscore and dash only'),
  email: z.string().email('Enter a valid email address').max(160),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100).optional(),
  full_name: z.string().min(2).max(160),
  phone: z.string().max(20).optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  role_code: z.enum(Object.values(ROLES)),
  campus_id: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

/** Guard: only Admin may create or touch another Admin account. */
function assertRoleAssignable(req, roleCode) {
  if (roleCode === ROLES.ADMIN && !isAdmin(req.user)) {
    throw forbidden('Only an Admin may manage Admin accounts');
  }
}

// ------------------------------------------------------------------ list
router.get(
  '/',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'username', 'full_name', 'email', 'created_at', 'last_login_at'], 'id');

    const clauses = [];
    const params = [];
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('u.campus_id = ?');
      params.push(req.user.campus_id);
    }
    if (req.query.role && req.query.role !== 'ALL') {
      clauses.push('r.code = ?');
      params.push(req.query.role);
    }
    if (req.query.status && req.query.status !== 'ALL') {
      clauses.push('u.status = ?');
      params.push(req.query.status);
    }
    if (req.query.search) {
      clauses.push('(u.full_name ILIKE ? OR u.username ILIKE ? OR u.email ILIKE ? OR u.phone ILIKE ?)');
      const term = `%${req.query.search}%`;
      params.push(term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id ${where}`, params));
    const rows = await all(
      `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.photo, u.gender, u.status,
              u.last_login_at, u.must_change_password, u.created_at,
              r.code AS role_code, r.name AS role_name, c.name AS campus_name, u.campus_id,
              (SELECT COUNT(*) FROM user_permissions up WHERE up.user_id = u.id) AS override_count
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN campuses c ON c.id = u.campus_id
         ${where}
        ORDER BY u.${column} ${direction}
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginated(res, rows, total, { page, limit });
  })
);

// --------------------------------------------------------------- detail
router.get(
  '/:id',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const user = await get(
      `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.photo, u.gender, u.status,
              u.campus_id, u.last_login_at, u.must_change_password, u.created_at,
              r.code AS role_code, r.name AS role_name, c.name AS campus_name
         FROM users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN campuses c ON c.id = u.campus_id
        WHERE u.id = ?`,
      [Number(req.params.id)]
    );
    if (!user) throw notFound('User not found');
    if (!isAdmin(req.user) && user.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const overrides = await all(
      `SELECT up.id, up.effect, p.code, p.module, p.action
         FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = ? ORDER BY p.code`,
      [user.id]
    );
    const rolePermissions = (await all(
      `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         JOIN roles r ON r.id = rp.role_id
        WHERE r.code = ?`,
      [user.role_code]
    )).map((r) => r.code);

    return ok(res, { ...user, overrides, rolePermissions });
  })
);

// --------------------------------------------------------------- create
router.post(
  '/',
  requirePermission('users.create'),
  validateBody(userSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    assertRoleAssignable(req, body.role_code);

    const role = await get('SELECT * FROM roles WHERE code = ?', [body.role_code]);
    if (!role) throw badRequest('Unknown role');

    if (await get('SELECT 1 AS x FROM users WHERE lower(username) = lower(?)', [body.username])) {
      throw conflict('That username is already taken');
    }
    if (await get('SELECT 1 AS x FROM users WHERE lower(email) = lower(?)', [body.email])) {
      throw conflict('That email address is already registered');
    }

    const password = body.password || env.seedPassword;
    const id = await insert('users', {
      username: body.username,
      email: body.email,
      password_hash: await hashPassword(password),
      full_name: body.full_name,
      phone: body.phone,
      gender: body.gender,
      role_id: role.id,
      campus_id: isAdmin(req.user) ? body.campus_id ?? req.user.campus_id : req.user.campus_id,
      status: body.status || 'ACTIVE',
      must_change_password: body.password ? 0 : 1,
      created_by: req.user.id,
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'users',
      entityType: 'User',
      entityId: id,
      description: `Created ${role.code} account "${body.username}"`,
      newValues: { username: body.username, email: body.email, role: role.code },
    });

    const row = await get('SELECT id, username, email, full_name, status FROM users WHERE id = ?', [id]);
    return created(res, { ...row, temporaryPassword: body.password ? undefined : password });
  })
);

// --------------------------------------------------------------- update
router.put(
  '/:id',
  requirePermission('users.edit'),
  validateBody(userSchema.partial().omit({ password: true })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);
    if (req.body.role_code) assertRoleAssignable(req, req.body.role_code);
    if (!isAdmin(req.user) && existing.campus_id !== req.user.campus_id) throw forbidden('Different campus');

    const data = {
      username: req.body.username,
      email: req.body.email,
      full_name: req.body.full_name,
      phone: req.body.phone,
      gender: req.body.gender,
      status: req.body.status,
    };
    if (req.body.role_code) {
      const role = await get('SELECT id FROM roles WHERE code = ?', [req.body.role_code]);
      if (!role) throw badRequest('Unknown role');
      data.role_id = role.id;
    }
    if (isAdmin(req.user) && req.body.campus_id !== undefined) data.campus_id = req.body.campus_id;

    await update('users', id, data);
    const changes = diff(existing, { ...existing, ...data });
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'users',
      entityType: 'User',
      entityId: id,
      description: `Updated user "${existing.username}"`,
      oldValues: changes.old,
      newValues: changes.new,
    });

    if (data.status && data.status !== 'ACTIVE') await revokeAllUserTokens(id);
    return ok(res, await get('SELECT id, username, email, full_name, status FROM users WHERE id = ?', [id]));
  })
);

/** Activate / deactivate — the spec calls these out explicitly. */
router.patch(
  '/:id/status',
  requirePermission('users.manage', 'users.edit'),
  validateBody(z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);
    if (id === req.user.id) throw badRequest('You cannot change the status of your own account');

    await update('users', id, { status: req.body.status });
    if (req.body.status !== 'ACTIVE') await revokeAllUserTokens(id);

    await logActivity({
      req,
      action: req.body.status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
      module: 'users',
      entityType: 'User',
      entityId: id,
      description: `Set "${existing.username}" to ${req.body.status}`,
      oldValues: { status: existing.status },
      newValues: { status: req.body.status },
    });
    return ok(res, { id, status: req.body.status });
  })
);

/** Admin-issued password reset. */
router.post(
  '/:id/reset-password',
  requirePermission('users.manage'),
  validateBody(z.object({ password: z.string().min(8).max(100).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await get('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);

    const password = req.body.password || `Vignan@${Math.floor(1000 + Math.random() * 9000)}`;
    await run("UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [
      await hashPassword(password),
      id,
    ]);
    await revokeAllUserTokens(id);

    await logActivity({
      req,
      action: 'PASSWORD_RESET',
      module: 'users',
      entityType: 'User',
      entityId: id,
      description: `Reset password for "${existing.username}"`,
    });
    return ok(res, { id, temporaryPassword: password });
  })
);

// -------------------------------------------- per-user permission overrides
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
    const target = await get('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw notFound('User not found');

    const before = await all(
      `SELECT p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?`,
      [id]
    );

    const apply = transaction(async () => {
      await run('DELETE FROM user_permissions WHERE user_id = ?', [id]);
      for (const [effect, codes] of [
        ['ALLOW', req.body.allow],
        ['DENY', req.body.deny],
      ]) {
        for (const code of codes) {
          const permission = await get('SELECT id FROM permissions WHERE code = ?', [code]);
          if (!permission) continue;
          await run(
            'INSERT INTO user_permissions (user_id, permission_id, effect, granted_by) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, permission_id) DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by',
            [id, permission.id, effect, req.user.id]
          );
        }
      }
    });
    await apply();

    await logActivity({
      req,
      action: 'PERMISSION_CHANGE',
      module: 'roles',
      entityType: 'User',
      entityId: id,
      description: `Changed permission overrides for "${target.username}"`,
      oldValues: before,
      newValues: { allow: req.body.allow, deny: req.body.deny },
    });

    return ok(res, { id, allow: req.body.allow, deny: req.body.deny });
  })
);

// --------------------------------------------------------------- delete
router.delete(
  '/:id',
  requirePermission('users.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw badRequest('You cannot delete your own account');
    const existing = await get('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);

    if (existing.role_code === ROLES.ADMIN) {
      const admins = Number(
        await scalar(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.status = 'ACTIVE'`)
      );
      if (admins <= 1) throw badRequest('At least one active Admin account must remain');
    }

    await run('DELETE FROM users WHERE id = ?', [id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'users',
      entityType: 'User',
      entityId: id,
      description: `Deleted user "${existing.username}"`,
      oldValues: { username: existing.username, email: existing.email, role: existing.role_code },
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
