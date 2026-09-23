import { Router } from 'express';
import { z } from 'zod';
import { Administrator, Permission, Role, RolePermission, User, UserPermission } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { escapeRegex, insensitive, lift, plain, populateFor } from '../db/mongo/query.js';
import { sameId } from '../lib/scope.js';
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

/** What the joins lifted from the account and the department. */
const JOINED = {
  user_id: {
    full_name: 'full_name', email: 'email', phone: 'phone', photo: 'photo',
    username: 'username', gender: 'gender', status: 'account_status',
    last_login_at: 'last_login_at',
  },
  department_id: { name: 'department_name' },
};

/**
 * How many permissions each of these people has been given beyond their role,
 * and how many taken away. Two correlated subqueries; one grouped query.
 */
async function overrideCounts(userIds) {
  const ids = userIds.map(oid).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await UserPermission.aggregate([
    { $match: { user_id: { $in: ids } } },
    {
      $group: {
        _id: '$user_id',
        extra_permissions: { $sum: { $cond: [{ $eq: ['$effect', 'ALLOW'] }, 1, 0] } },
        revoked_permissions: { $sum: { $cond: [{ $eq: ['$effect', 'DENY'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

/** One administrator, in the shape the joins produced. */
async function loadAdministrator(id) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await Administrator.findById(_id).populate(populateFor(JOINED));
  if (!doc) return null;
  const row = lift(doc, JOINED);
  const counts = await overrideCounts([row.user_id]);
  row.extra_permissions = counts.get(String(row.user_id))?.extra_permissions ?? 0;
  row.revoked_permissions = counts.get(String(row.user_id))?.revoked_permissions ?? 0;
  return row;
}

/** The next free employee code, counted from the highest in use. */
async function nextEmployeeCode(campusId) {
  return (await employeeCodes(campusId)).take();
}

/** Apply per-user permission overrides for an administrator. */
async function applyOverrides(userId, allow = [], deny = [], grantedBy, session = null) {
  const opts = session ? { session } : {};
  await UserPermission.deleteMany({ user_id: oid(userId) }, opts);

  // A code in both lists was settled by the unique key, with the last write
  // winning — DENY is applied after ALLOW, so it still is.
  const wanted = new Map();
  for (const [effect, codes] of [['ALLOW', allow], ['DENY', deny]]) {
    for (const code of codes) wanted.set(code, effect);
  }
  if (!wanted.size) return;

  const permissions = await Permission.find({ code: { $in: [...wanted.keys()] } })
    .select('code').lean();
  if (!permissions.length) return;

  await UserPermission.insertMany(
    permissions.map((perm) => ({
      user_id: oid(userId),
      permission_id: perm._id,
      effect: wanted.get(perm.code),
      granted_by: oid(grantedBy),
    })),
    { ...opts, ordered: false }
  );
}

router.get(
  '/',
  requirePermission('administrators.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'employee_code', 'date_of_joining', 'created_at'], 'id');

    const filter = {};
    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);
    for (const field of ['status', 'department_id']) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        filter[field] = field.endsWith('_id') ? oid(req.query[field]) : req.query[field];
      }
    }

    /*
     * Searching matches the person's name and email, which live on their
     * account rather than on the administrator record — the join is what let
     * the WHERE reach them. The matching accounts are found first.
     */
    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      const accounts = await User.find({ $or: [{ full_name: term }, { email: term }] })
        .select('_id').lean();
      filter.$or = [
        { employee_code: term },
        { designation: term },
        { user_id: { $in: accounts.map((u) => u._id) } },
      ];
    }

    const sortField = column === 'id' ? '_id' : column;
    const [docs, total] = await Promise.all([
      Administrator.find(filter)
        .populate(populateFor(JOINED))
        .sort({ [sortField]: direction === 'ASC' ? 1 : -1, _id: 1 })
        .skip(offset)
        .limit(limit),
      Administrator.countDocuments(filter),
    ]);

    const rows = lift(docs, JOINED);
    const counts = await overrideCounts(rows.map((r) => r.user_id));
    for (const row of rows) {
      row.extra_permissions = counts.get(String(row.user_id))?.extra_permissions ?? 0;
      row.revoked_permissions = counts.get(String(row.user_id))?.revoked_permissions ?? 0;
    }
    return paginated(res, rows, total, { page, limit });
  })
);

router.get(
  '/:id',
  requirePermission('administrators.view'),
  asyncHandler(async (req, res) => {
    const row = await loadAdministrator(req.params.id);
    if (!row) throw notFound('Administrator not found');
    if (!isAdmin(req.user) && !sameId(row.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    const overrideDocs = await UserPermission.find({ user_id: oid(row.user_id) })
      .populate('permission_id', 'code module action');
    const overrides = overrideDocs
      .filter((o) => o.permission_id)
      .map((o) => ({
        code: o.permission_id.code,
        module: o.permission_id.module,
        action: o.permission_id.action,
        effect: o.effect,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const role = await Role.findOne({ code: 'ADMINISTRATOR' }).select('_id').lean();
    const granted = role
      ? await RolePermission.find({ role_id: role._id }).populate('permission_id', 'code')
      : [];
    const rolePermissions = granted.map((rp) => rp.permission_id?.code).filter(Boolean);

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

    const role = await Role.findOne({ code: 'ADMINISTRATOR' }).select('_id').lean();
    const employeeCode = body.employee_code || await nextEmployeeCode(campusId);
    const username = body.username || employeeCode.toLowerCase();

    if (await User.exists({ username: insensitive(username) })) throw conflict('That username is taken');
    if (await User.exists({ email: insensitive(body.email) })) throw conflict('That email is registered');
    if (await Administrator.exists({ employee_code: employeeCode })) throw conflict('That employee code exists');

    const password = body.password || env.seedPassword;
    const passwordHash = await hashPassword(password);

    const result = await transaction(async (session) => {
      const opts = session ? { session } : {};
      const [account] = await User.create([{
        username,
        email: body.email,
        password_hash: passwordHash,
        full_name: body.full_name,
        phone: body.phone,
        gender: body.gender,
        role_id: role?._id,
        campus_id: oid(campusId),
        status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        must_change_password: body.password ? 0 : 1,
        created_by: oid(req.user.id),
      }], opts);
      const userId = account._id;

      const [administrator] = await Administrator.create([{
        user_id: userId,
        campus_id: oid(campusId),
        employee_code: employeeCode,
        designation: body.designation || 'Administrator',
        board: body.board || 'BOTH',
        department_id: oid(body.department_id),
        date_of_joining: body.date_of_joining || new Date().toISOString().slice(0, 10),
        qualification: body.qualification,
        address: body.address,
        emergency_contact: body.emergency_contact,
        status: body.status || 'ACTIVE',
      }], opts);

      if (body.allow_permissions?.length || body.deny_permissions?.length) {
        await applyOverrides(userId, body.allow_permissions || [], body.deny_permissions || [], req.user.id, session);
      }
      return { userId: String(userId), adminId: String(administrator._id) };
    });

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

    const row = await loadAdministrator(result.adminId);
    return created(res, { ...row, temporaryPassword: body.password ? undefined : password });
  })
);

router.put(
  '/:id',
  requireRole(ROLES.ADMIN),
  requirePermission('administrators.edit'),
  validateBody(administratorSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = plain(await Administrator.findById(oid(id)));
    if (!existing) throw notFound('Administrator not found');

    const data = {};
    for (const f of ['designation', 'board', 'department_id', 'date_of_joining', 'qualification', 'address', 'emergency_contact', 'status']) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (Object.keys(data).length) {
      await Administrator.updateOne({ _id: oid(id) }, { $set: data }, { runValidators: true });
    }

    const userData = {};
    for (const f of ['full_name', 'email', 'phone', 'gender']) if (req.body[f] !== undefined) userData[f] = req.body[f];
    if (req.body.status) userData.status = req.body.status;
    if (Object.keys(userData).length) {
      await User.updateOne({ _id: oid(existing.user_id) }, { $set: userData });
    }

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

    return ok(res, await loadAdministrator(id));
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
    const id = req.params.id;
    const administratorDoc = await Administrator.findById(oid(id)).populate('user_id', 'full_name');
    const administrator = administratorDoc
      ? lift(administratorDoc, { user_id: { full_name: 'full_name' } })
      : null;
    if (!administrator) throw notFound('Administrator not found');

    const beforeDocs = await UserPermission.find({ user_id: oid(administrator.user_id) })
      .populate('permission_id', 'code');
    const before = beforeDocs
      .filter((o) => o.permission_id)
      .map((o) => ({ code: o.permission_id.code, effect: o.effect }));

    await transaction((session) =>
      applyOverrides(administrator.user_id, req.body.allow, req.body.deny, req.user.id, session));

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
    const id = req.params.id;
    const existing = plain(await Administrator.findById(oid(id)));
    if (!existing) throw notFound('Administrator not found');

    /*
     * The record, the overrides attached to the account, and the account
     * itself. ON DELETE CASCADE took the overrides with the user; nothing
     * does that here, and an override left behind would be applied to whoever
     * is given that id next.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await Administrator.deleteOne({ _id: oid(id) }, opts);
      if (existing.user_id) {
        await UserPermission.deleteMany({ user_id: oid(existing.user_id) }, opts);
        await User.deleteOne({ _id: oid(existing.user_id) }, opts);
      }
    });
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
