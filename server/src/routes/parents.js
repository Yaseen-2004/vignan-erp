import { Router } from 'express';
import { z } from 'zod';
import { Parent, Role, Student, StudentParent, User } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { sameId } from '../lib/scope.js';
import { escapeRegex, insensitive, lift, plain, populateFor } from '../db/mongo/query.js';
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
  student_ids: z.array(z.string()).optional(),
});

/** What the join lifted from the sign-in account onto each family record. */
const ACCOUNT = {
  user_id: {
    username: 'username',
    full_name: 'full_name',
    status: 'account_status',
    last_login_at: 'last_login_at',
    photo: 'photo',
  },
};

/** One family record, in the shape the join produced. */
async function loadParent(id) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await Parent.findById(_id).populate(populateFor(ACCOUNT));
  if (!doc) return null;
  const row = lift(doc, ACCOUNT);
  row.children_count = await StudentParent.countDocuments({ parent_id: _id });
  return row;
}

/**
 * The children linked to these families.
 *
 * Fetched for the whole page at once. One query per family to draw a list of
 * twenty-five was twenty-five round trips, and the list shows the children on
 * every row.
 */
async function childrenFor(parentIds, { detailed = false } = {}) {
  const ids = parentIds.map(oid).filter(Boolean);
  if (!ids.length) return new Map();

  const links = await StudentParent.find({ parent_id: { $in: ids } })
    .populate({
      path: 'student_id',
      select: 'first_name last_name admission_number photo status class_id section_id',
      populate: [{ path: 'class_id', select: 'name' }, { path: 'section_id', select: 'name' }],
    });

  const byParent = new Map();
  for (const link of links) {
    if (!link.student_id) continue;
    const child = {
      id: String(link.student_id._id),
      first_name: link.student_id.first_name,
      last_name: link.student_id.last_name,
      admission_number: link.student_id.admission_number,
      class_name: link.student_id.class_id?.name ?? null,
      section_name: link.student_id.section_id?.name ?? null,
      ...(detailed
        ? {
          photo: link.student_id.photo,
          status: link.student_id.status,
          // These belong to the link, not the child: how this adult is
          // related to this child, and whether they are the first contact.
          relation: link.relation,
          is_primary: link.is_primary,
        }
        : {}),
    };
    const key = String(link.parent_id);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(child);
  }
  return byParent;
}

router.get(
  '/',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'parent_code', 'created_at'], 'id');

    const filter = {};
    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('p.campus_id = ?');
      params.push(req.user.campus_id);
    }
    // A parent may only ever read their own record.
    if (isParent(req.user)) {
      clauses.push('p.id = ?');
      params.push(await parentIdOf(req.user) ?? 0);
    }
    if (req.query.status && req.query.status !== 'ALL') filter.status = req.query.status;
    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [
        { father_name: term }, { mother_name: term }, { phone: term },
        { parent_code: term }, { email: term },
      ];
    }

    const sortField = column === 'id' ? '_id' : column;
    const [docs, total] = await Promise.all([
      Parent.find(filter)
        .populate(populateFor(ACCOUNT))
        .sort({ [sortField]: direction === 'ASC' ? 1 : -1, _id: 1 })
        .skip(offset)
        .limit(limit),
      Parent.countDocuments(filter),
    ]);
    const rows = lift(docs, ACCOUNT);

    // Attach the children so the list can show "Child 1 — 8A, Child 2 — 5B".
    const children = await childrenFor(rows.map((r) => r.id));
    for (const row of rows) {
      row.children = children.get(row.id) ?? [];
      row.children_count = row.children.length;
    }
    return paginated(res, rows, total, { page, limit });
  })
);

router.get(
  '/:id',
  requirePermission('parents.view'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    /*
     * The original compared `await parentIdOf(req.user) !== id` — await binds
     * tighter than !== only because of the parentheses that were not there,
     * so this read as `await (parentIdOf(...) !== id)`: a promise is never
     * equal to a number, so the check was always true and a parent was
     * refused their own record. Parenthesised, and comparing as strings.
     */
    if (isParent(req.user) && !sameId(await parentIdOf(req.user), id)) {
      throw forbidden('You may only view your own record');
    }

    const parent = await loadParent(id);
    if (!parent) throw notFound('Parent not found');
    if (!isAdmin(req.user) && !isParent(req.user) && !sameId(parent.campus_id, req.user.campus_id)) {
      throw forbidden('Different campus');
    }

    parent.children = (await childrenFor([id], { detailed: true })).get(String(id)) ?? [];

    return ok(res, parent);
  })
);

router.post(
  '/',
  requirePermission('parents.create'),
  validateBody(parentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const campusId = isAdmin(req.user) && req.body.campus_id ? req.body.campus_id : req.user.campus_id;
    if (!campusId) throw badRequest('No campus is associated with your account');

    // A truncated timestamp repeats about every 27 hours, and two parents
    // added in the same millisecond collide outright.
    const parentCode = (await parentCodes(campusId)).take();
    const username = body.username || parentCode.toLowerCase();
    if (body.create_account && await User.exists({ username: insensitive(username) })) {
      throw conflict('That username is taken');
    }

    const password = body.password || env.seedPassword;
    const passwordHash = body.create_account ? await hashPassword(password) : null;

    const result = await transaction(async (session) => {
      const opts = session ? { session } : {};
      let userId = null;
      if (body.create_account) {
        const role = await Role.findOne({ code: 'PARENT' }).select('_id').lean();
        const [account] = await User.create([{
          username,
          email: body.email || `${username}@parent.vignan.edu`,
          password_hash: passwordHash,
          full_name: body.father_name || body.mother_name || body.guardian_name || 'Parent',
          phone: body.phone || body.father_phone || body.mother_phone,
          role_id: role?._id,
          campus_id: oid(campusId),
          status: 'ACTIVE',
          must_change_password: body.password ? 0 : 1,
          created_by: oid(req.user.id),
        }], opts);
        userId = account._id;
      }

      const [family] = await Parent.create([{
        user_id: userId,
        campus_id: oid(campusId),
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
      }], opts);
      const parentId = family._id;

      // Linking the same child twice was refused by the unique key; an
      // unordered insert keeps going past a duplicate rather than failing the
      // whole family record over one repeated child.
      const childIds = (body.student_ids || []).map(oid).filter(Boolean);
      if (childIds.length) {
        await StudentParent.insertMany(
          childIds.map((studentId) => ({
            student_id: studentId,
            parent_id: parentId,
            relation: body.relation || 'FATHER',
            is_primary: 1,
          })),
          { ...opts, ordered: false }
        ).catch((error) => { if (error?.code !== 11000) throw error; });
      }
      return { parentId: String(parentId), userId: userId ? String(userId) : null };
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'parents',
      entityType: 'Parent',
      entityId: result.parentId,
      description: `Created parent record ${parentCode}`,
      newValues: { parent_code: parentCode, children: body.student_ids || [] },
    });

    const row = await loadParent(result.parentId);
    return created(res, { ...row, temporaryPassword: body.create_account && !body.password ? password : undefined });
  })
);

router.put(
  '/:id',
  requirePermission('parents.edit'),
  validateBody(parentSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = plain(await Parent.findById(oid(id)));
    if (!existing) throw notFound('Parent not found');
    if (!isAdmin(req.user) && !sameId(existing.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    const data = {};
    for (const f of [
      'father_name', 'father_occupation', 'father_phone', 'mother_name', 'mother_occupation',
      'mother_phone', 'guardian_name', 'relation', 'email', 'phone', 'address', 'annual_income', 'status',
    ]) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (Object.keys(data).length) {
      await Parent.updateOne({ _id: oid(id) }, { $set: data }, { runValidators: true });
    }

    // The sign-in account carries the same name and number, so it follows.
    if (existing.user_id && (data.father_name || data.phone)) {
      const accountUpdate = {};
      if (data.father_name ?? existing.father_name) {
        accountUpdate.full_name = data.father_name ?? existing.father_name;
      }
      if (data.phone !== undefined) accountUpdate.phone = data.phone;
      if (Object.keys(accountUpdate).length) {
        await User.updateOne({ _id: oid(existing.user_id) }, { $set: accountUpdate });
      }
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
    return ok(res, await loadParent(id));
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
    const id = req.params.id;
    const parent = plain(await Parent.findById(oid(id)));
    if (!parent) throw notFound('Parent not found');
    const student = plain(await Student.findById(oid(req.body.student_id)));
    if (!student) throw notFound('Student not found');
    if (!sameId(student.campus_id, parent.campus_id)) throw badRequest('Student and parent belong to different campuses');

    // Linking the same pair again changes the relation rather than adding a
    // second link, which is what ON CONFLICT DO UPDATE did.
    await StudentParent.updateOne(
      { student_id: oid(student.id), parent_id: oid(id) },
      { $set: { relation: req.body.relation, is_primary: req.body.is_primary ? 1 : 0 } },
      { upsert: true }
    );

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
    const id = req.params.id;
    const studentId = req.params.studentId;
    const parent = plain(await Parent.findById(oid(id)));
    if (!parent) throw notFound('Parent not found');

    await StudentParent.deleteOne({ parent_id: oid(id), student_id: oid(studentId) });
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
    const id = req.params.id;
    const parent = plain(await Parent.findById(oid(id)));
    if (!parent) throw notFound('Parent not found');
    if (!isAdmin(req.user) && !sameId(parent.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    /*
     * The family record, its links to the children, and the sign-in account
     * go together. ON DELETE CASCADE removed the links; nothing does that
     * here, and a link left pointing at a family that no longer exists would
     * show a child as having a parent who cannot be found.
     */
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await StudentParent.deleteMany({ parent_id: oid(id) }, opts);
      await Parent.deleteOne({ _id: oid(id) }, opts);
      if (parent.user_id) await User.deleteOne({ _id: oid(parent.user_id) }, opts);
    });
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
