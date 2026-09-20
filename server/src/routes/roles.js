import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar, transaction } from '../db/connection.js';
import { asyncHandler, ok, created } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logActivity } from '../lib/audit.js';
import { MODULES, ROLES } from '../lib/permissions.js';

const router = Router();

/** The permission catalogue, grouped by module — drives the Admin matrix UI. */
router.get(
  '/permissions',
  requirePermission('roles.view'),
  asyncHandler(async (_req, res) => {
    const rows = await all('SELECT id, code, module, action, description FROM permissions ORDER BY module, action');
    const grouped = {};
    for (const row of rows) {
      const label = MODULES[row.module]?.label || row.module;
      grouped[row.module] ??= { module: row.module, label, permissions: [] };
      grouped[row.module].permissions.push(row);
    }
    return ok(res, Object.values(grouped));
  })
);

router.get(
  '/',
  requirePermission('roles.view'),
  asyncHandler(async (_req, res) => {
    const roles = await all(
      `SELECT r.*,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
         FROM roles r ORDER BY r.level, r.name`
    );
    return ok(res, roles);
  })
);

router.get(
  '/:id',
  requirePermission('roles.view'),
  asyncHandler(async (req, res) => {
    const role = await get('SELECT * FROM roles WHERE id = ?', [Number(req.params.id)]);
    if (!role) throw notFound('Role not found');
    const permissions = await all(
      `SELECT p.id, p.code, p.module, p.action FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ? ORDER BY p.module, p.action`,
      [role.id]
    );
    const users = Number(await scalar('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', [role.id]));
    return ok(res, { ...role, permissions, user_count: users });
  })
);

router.post(
  '/',
  requireRole(ROLES.ADMIN),
  requirePermission('roles.create'),
  validateBody(
    z.object({
      code: z.string().min(3).max(40).regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, numbers and underscores'),
      name: z.string().min(2).max(80),
      description: z.string().max(400).optional(),
      level: z.coerce.number().int().min(1).max(99).default(50),
    })
  ),
  asyncHandler(async (req, res) => {
    if (await get('SELECT 1 AS x FROM roles WHERE code = ?', [req.body.code])) throw badRequest('That role code already exists');
    const id = await insert('roles', { ...req.body, is_system: 0 });
    await logActivity({
      req,
      action: 'CREATE',
      module: 'roles',
      entityType: 'Role',
      entityId: id,
      description: `Created role ${req.body.code}`,
      newValues: req.body,
    });
    return created(res, await get('SELECT * FROM roles WHERE id = ?', [id]));
  })
);

router.put(
  '/:id',
  requireRole(ROLES.ADMIN),
  requirePermission('roles.edit'),
  validateBody(
    z.object({
      name: z.string().min(2).max(80).optional(),
      description: z.string().max(400).optional(),
      level: z.coerce.number().int().min(1).max(99).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const role = await get('SELECT * FROM roles WHERE id = ?', [id]);
    if (!role) throw notFound('Role not found');
    await update('roles', id, req.body);
    await logActivity({
      req,
      action: 'ROLE_CHANGE',
      module: 'roles',
      entityType: 'Role',
      entityId: id,
      description: `Updated role ${role.code}`,
      oldValues: { name: role.name, description: role.description, level: role.level },
      newValues: req.body,
    });
    return ok(res, await get('SELECT * FROM roles WHERE id = ?', [id]));
  })
);

/** Replace a role's permission set. Admin only — the spec is explicit about this. */
router.put(
  '/:id/permissions',
  requireRole(ROLES.ADMIN),
  requirePermission('roles.manage'),
  validateBody(z.object({ codes: z.array(z.string()).default([]) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const role = await get('SELECT * FROM roles WHERE id = ?', [id]);
    if (!role) throw notFound('Role not found');
    if (role.code === ROLES.ADMIN) {
      throw forbidden('The Admin role must retain complete access and cannot be restricted');
    }

    const before = (await all(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
      [id]
    )).map((r) => r.code);

    const apply = transaction(async () => {
      await run('DELETE FROM role_permissions WHERE role_id = ?', [id]);
      for (const code of req.body.codes) {
        const permission = await get('SELECT id FROM permissions WHERE code = ?', [code]);
        if (permission) {
          await run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, permission.id]);
        }
      }
    });
    await apply();

    await logActivity({
      req,
      action: 'PERMISSION_CHANGE',
      module: 'roles',
      entityType: 'Role',
      entityId: id,
      description: `Changed permissions for role ${role.code} (${before.length} to ${req.body.codes.length})`,
      oldValues: { permissions: before },
      newValues: { permissions: req.body.codes },
    });

    return ok(res, { id, count: req.body.codes.length });
  })
);

router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  requirePermission('roles.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const role = await get('SELECT * FROM roles WHERE id = ?', [id]);
    if (!role) throw notFound('Role not found');
    if (role.is_system) throw badRequest('System roles cannot be deleted');
    const users = Number(await scalar('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', [id]));
    if (users) throw badRequest(`${users} user(s) still use this role`);

    await run('DELETE FROM roles WHERE id = ?', [id]);
    await logActivity({
      req,
      action: 'DELETE',
      module: 'roles',
      entityType: 'Role',
      entityId: id,
      description: `Deleted role ${role.code}`,
      oldValues: role,
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
