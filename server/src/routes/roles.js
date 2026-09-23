import { Router } from 'express';
import { z } from 'zod';
import { Permission, Role, RolePermission, User } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { plain } from '../db/mongo/query.js';
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
    const rows = plain(
      await Permission.find({}).select('code module action description').sort({ module: 1, action: 1 })
    );
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
    const roles = plain(await Role.find({}).sort({ level: 1, name: 1 }));

    // The two counts were correlated subqueries — one grouped query each here,
    // rather than two per role.
    const countBy = async (Model, field) => {
      const rows = await Model.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
      return new Map(rows.map((r) => [String(r._id), r.n]));
    };
    const [perms, users] = await Promise.all([
      countBy(RolePermission, 'role_id'),
      countBy(User, 'role_id'),
    ]);
    for (const role of roles) {
      role.permission_count = perms.get(role.id) ?? 0;
      role.user_count = users.get(role.id) ?? 0;
    }
    return ok(res, roles);
  })
);

router.get(
  '/:id',
  requirePermission('roles.view'),
  asyncHandler(async (req, res) => {
    const roleDoc = await Role.findById(oid(req.params.id));
    if (!roleDoc) throw notFound('Role not found');
    const role = plain(roleDoc);

    const granted = await RolePermission.find({ role_id: roleDoc._id })
      .populate('permission_id', 'code module action');
    const permissions = granted
      .map((rp) => rp.permission_id)
      .filter(Boolean)
      .map((p2) => plain(p2))
      .sort((a, b) => a.module.localeCompare(b.module) || a.action.localeCompare(b.action));

    const users = await User.countDocuments({ role_id: roleDoc._id });
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
    if (await Role.exists({ code: req.body.code })) throw badRequest('That role code already exists');
    const id = String((await Role.create({ ...req.body, is_system: 0 }))._id);
    await logActivity({
      req,
      action: 'CREATE',
      module: 'roles',
      entityType: 'Role',
      entityId: id,
      description: `Created role ${req.body.code}`,
      newValues: req.body,
    });
    return created(res, plain(await Role.findById(oid(id))));
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
    const id = req.params.id;
    const role = plain(await Role.findById(oid(id)));
    if (!role) throw notFound('Role not found');
    await Role.updateOne({ _id: oid(id) }, { $set: req.body }, { runValidators: true });
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
    return ok(res, plain(await Role.findById(oid(id))));
  })
);

/** Replace a role's permission set. Admin only — the spec is explicit about this. */
router.put(
  '/:id/permissions',
  requireRole(ROLES.ADMIN),
  requirePermission('roles.manage'),
  validateBody(z.object({ codes: z.array(z.string()).default([]) })),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const role = plain(await Role.findById(oid(id)));
    if (!role) throw notFound('Role not found');
    if (role.code === ROLES.ADMIN) {
      throw forbidden('The Admin role must retain complete access and cannot be restricted');
    }

    const before = (await RolePermission.find({ role_id: oid(id) }).populate('permission_id', 'code'))
      .map((rp) => rp.permission_id?.code)
      .filter(Boolean);

    /*
     * Replaced as one unit. Between the removal and the additions a role has
     * no permissions at all, and a request arriving in that moment would be
     * refused everything — which is why this is a transaction and not two
     * independent writes.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await RolePermission.deleteMany({ role_id: oid(id) }, opts);

      // The codes are resolved in one query rather than one apiece.
      const wanted = await Permission.find({ code: { $in: req.body.codes } }).select('_id').lean();
      if (wanted.length) {
        await RolePermission.insertMany(
          wanted.map((p2) => ({ role_id: oid(id), permission_id: p2._id })),
          { ...opts, ordered: false }
        );
      }
    });

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
    const id = req.params.id;
    const role = plain(await Role.findById(oid(id)));
    if (!role) throw notFound('Role not found');
    if (role.is_system) throw badRequest('System roles cannot be deleted');
    // What the foreign key used to refuse: a role still in use.
    const users = await User.countDocuments({ role_id: oid(id) });
    if (users) throw badRequest(`${users} user(s) still use this role`);

    await Role.deleteOne({ _id: oid(id) });
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
