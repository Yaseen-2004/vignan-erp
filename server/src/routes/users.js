import { Router } from 'express';
import { z } from 'zod';
import { Permission, Role, RolePermission, User, UserPermission } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { escapeRegex, insensitive, lift, plain } from '../db/mongo/query.js';
import { sameId } from '../lib/scope.js';
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

    const filter = {};
    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);
    if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status;

    // The role is matched by its code, which lives on the role rather than on
    // the account — the join is what let the WHERE reach it.
    if (req.query.role && req.query.role !== 'ALL') {
      const role = await Role.findOne({ code: req.query.role }).select('_id').lean();
      if (!role) return paginated(res, [], 0, { page, limit });
      filter.role_id = role._id;
    }

    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ full_name: term }, { username: term }, { email: term }, { phone: term }];
    }

    const sortField = column === 'id' ? '_id' : column;
    const [docs, total] = await Promise.all([
      User.find(filter)
        .select('username email full_name phone photo gender status last_login_at must_change_password created_at role_id campus_id')
        .populate('role_id', 'code name')
        .populate('campus_id', 'name')
        .sort({ [sortField]: direction === 'ASC' ? 1 : -1, _id: 1 })
        .skip(offset)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    const rows = lift(docs, {
      role_id: { code: 'role_code', name: 'role_name' },
      campus_id: { name: 'campus_name' },
    });

    // The override count was a correlated subquery — one grouped query here.
    const overrides = await UserPermission.aggregate([
      { $match: { user_id: { $in: docs.map((d) => d._id) } } },
      { $group: { _id: '$user_id', n: { $sum: 1 } } },
    ]);
    const overrideFor = new Map(overrides.map((o) => [String(o._id), o.n]));
    for (const row of rows) row.override_count = overrideFor.get(row.id) ?? 0;
    return paginated(res, rows, total, { page, limit });
  })
);

// --------------------------------------------------------------- detail
router.get(
  '/:id',
  requirePermission('users.view'),
  asyncHandler(async (req, res) => {
    const doc = await User.findById(oid(req.params.id))
      .select('username email full_name phone photo gender status campus_id last_login_at must_change_password created_at role_id')
      .populate('role_id', 'code name')
      .populate('campus_id', 'name');
    if (!doc) throw notFound('User not found');

    const user = lift(doc, {
      role_id: { code: 'role_code', name: 'role_name' },
      campus_id: { name: 'campus_name' },
    });
    if (!isAdmin(req.user) && !sameId(user.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    const overrideDocs = await UserPermission.find({ user_id: doc._id })
      .populate('permission_id', 'code module action');
    const overrides = overrideDocs
      .filter((o) => o.permission_id)
      .map((o) => ({
        id: String(o._id),
        effect: o.effect,
        code: o.permission_id.code,
        module: o.permission_id.module,
        action: o.permission_id.action,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    // What the role grants, before this person's own additions and removals.
    const granted = doc.role_id
      ? await RolePermission.find({ role_id: doc.role_id._id }).populate('permission_id', 'code')
      : [];
    const rolePermissions = granted.map((rp) => rp.permission_id?.code).filter(Boolean);

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

    const role = plain(await Role.findOne({ code: body.role_code }));
    if (!role) throw badRequest('Unknown role');

    // Matched without regard to case, as lower() did: two accounts differing
    // only in capitalisation are the same account to whoever signs in.
    if (await User.exists({ username: insensitive(body.username) })) {
      throw conflict('That username is already taken');
    }
    if (await User.exists({ email: insensitive(body.email) })) {
      throw conflict('That email address is already registered');
    }

    const password = body.password || env.seedPassword;
    const id = String((await User.create({
      username: body.username,
      email: body.email,
      password_hash: await hashPassword(password),
      full_name: body.full_name,
      phone: body.phone,
      gender: body.gender,
      role_id: oid(role.id),
      campus_id: oid(isAdmin(req.user) ? body.campus_id ?? req.user.campus_id : req.user.campus_id),
      status: body.status || 'ACTIVE',
      must_change_password: body.password ? 0 : 1,
      created_by: oid(req.user.id),
    }))._id);

    await logActivity({
      req,
      action: 'CREATE',
      module: 'users',
      entityType: 'User',
      entityId: id,
      description: `Created ${role.code} account "${body.username}"`,
      newValues: { username: body.username, email: body.email, role: role.code },
    });

    const row = plain(await User.findById(oid(id)).select('username email full_name status'));
    return created(res, { ...row, temporaryPassword: body.password ? undefined : password });
  })
);

// --------------------------------------------------------------- update
router.put(
  '/:id',
  requirePermission('users.edit'),
  validateBody(userSchema.partial().omit({ password: true })),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existingDoc = await User.findById(oid(id)).populate('role_id', 'code');
    const existing = existingDoc ? lift(existingDoc, { role_id: { code: 'role_code' } }) : null;
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
      const role = await Role.findOne({ code: req.body.role_code }).select('_id').lean();
      if (!role) throw badRequest('Unknown role');
      data.role_id = role._id;
    }
    if (isAdmin(req.user) && req.body.campus_id !== undefined) data.campus_id = req.body.campus_id;

    // Only what was actually supplied: an absent field must not overwrite a
    // recorded one with nothing.
    const set = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) {
      await User.updateOne({ _id: oid(id) }, { $set: set }, { runValidators: true });
    }
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
    return ok(res, plain(await User.findById(oid(id)).select('username email full_name status')));
  })
);

/** Activate / deactivate — the spec calls these out explicitly. */
router.patch(
  '/:id/status',
  requirePermission('users.manage', 'users.edit'),
  validateBody(z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) })),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existingDoc = await User.findById(oid(id)).populate('role_id', 'code');
    const existing = existingDoc ? lift(existingDoc, { role_id: { code: 'role_code' } }) : null;
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);
    if (sameId(id, req.user.id)) throw badRequest('You cannot change the status of your own account');

    await User.updateOne({ _id: oid(id) }, { $set: { status: req.body.status } });
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
    const id = req.params.id;
    const existingDoc = await User.findById(oid(id)).populate('role_id', 'code');
    const existing = existingDoc ? lift(existingDoc, { role_id: { code: 'role_code' } }) : null;
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);

    const password = req.body.password || `Vignan@${Math.floor(1000 + Math.random() * 9000)}`;
    await User.updateOne({ _id: oid(id) }, {
      $set: {
        password_hash: await hashPassword(password),
        must_change_password: 1,
        failed_attempts: 0,
        locked_until: null,
      },
    });
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
    const id = req.params.id;
    const target = plain(await User.findById(oid(id)));
    if (!target) throw notFound('User not found');

    const beforeDocs = await UserPermission.find({ user_id: oid(id) }).populate('permission_id', 'code');
    const before = beforeDocs
      .filter((o) => o.permission_id)
      .map((o) => ({ code: o.permission_id.code, effect: o.effect }));

    /*
     * Replaced as one unit, for the reason the role's set is: between the
     * removal and the additions this person has no overrides, and a DENY that
     * momentarily disappears is access they should not have had.
     *
     * The same permission cannot be both allowed and denied — the unique key
     * on (user, permission) made the last one win, so DENY is applied after
     * ALLOW and keeps that behaviour.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await UserPermission.deleteMany({ user_id: oid(id) }, opts);

      const wanted = new Map();
      for (const [effect, codes] of [['ALLOW', req.body.allow], ['DENY', req.body.deny]]) {
        for (const code of codes) wanted.set(code, effect);
      }
      if (wanted.size) {
        const permissions = await Permission.find({ code: { $in: [...wanted.keys()] } })
          .select('code').lean();
        if (permissions.length) {
          await UserPermission.insertMany(
            permissions.map((perm) => ({
              user_id: oid(id),
              permission_id: perm._id,
              effect: wanted.get(perm.code),
              granted_by: oid(req.user.id),
            })),
            { ...opts, ordered: false }
          );
        }
      }
    });

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
    const id = req.params.id;
    if (sameId(id, req.user.id)) throw badRequest('You cannot delete your own account');
    const existingDoc = await User.findById(oid(id)).populate('role_id', 'code');
    const existing = existingDoc ? lift(existingDoc, { role_id: { code: 'role_code' } }) : null;
    if (!existing) throw notFound('User not found');
    assertRoleAssignable(req, existing.role_code);

    if (existing.role_code === ROLES.ADMIN) {
      // The school must not be left with nobody who can run it.
      const adminRole = await Role.findOne({ code: ROLES.ADMIN }).select('_id').lean();
      const admins = adminRole
        ? await User.countDocuments({ role_id: adminRole._id, status: 'ACTIVE' })
        : 0;
      if (admins <= 1) throw badRequest('At least one active Admin account must remain');
    }

    await User.deleteOne({ _id: oid(id) });
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
