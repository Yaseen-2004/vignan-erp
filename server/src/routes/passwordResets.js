/**
 * The forgotten-password queue.
 *
 * Someone who cannot sign in raises a request from the login page; staff work
 * through the queue here, identify the person, and issue a temporary password
 * that the account holder must change on first sign-in.
 *
 * Who may reset whom is deliberately narrower than "can see the queue": an
 * Administrator serves pupils, parents and teaching or financial staff, but
 * cannot reset an Admin's or another Administrator's password. Only an Admin
 * can do that — the same boundary the specification draws around system
 * settings.
 */
import { Router } from 'express';
import { z } from 'zod';
import { PasswordResetRequest, User } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { escapeRegex, lift, populateFor } from '../db/mongo/query.js';
import { hashPassword, revokeAllUserTokens } from '../lib/auth.js';
import { logActivity } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { asyncHandler, ok, pagination, paginated } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

// Mounted under the authenticated API router, so the session is already verified.
const router = Router();

/** Roles an Administrator is allowed to reset. Admin is not bounded. */
const ADMINISTRATOR_MAY_RESET = new Set(['STUDENT', 'PARENT', 'TEACHING_STAFF', 'FINANCIAL_STAFF']);

const assertMayReset = (actor, target) => {
  if (actor.role_code === 'ADMIN') return;
  if (!ADMINISTRATOR_MAY_RESET.has(target.role_code)) {
    throw forbidden('Only an Admin can reset the password of an Admin or Administrator account.');
  }
};

/**
 * What the three joins lifted onto each request: the account it is for, that
 * account's role, and whoever dealt with it.
 */
const JOINED = {
  user_id: {
    username: 'username',
    full_name: 'full_name',
    email: 'email',
    phone: 'phone',
    status: 'account_status',
  },
  'user_id.role_id': { code: 'role_code', name: 'role_name' },
  handled_by: { full_name: 'handled_by_name' },
};

/** One request, in the shape the joins produced. */
const loadRequest = async (id) => {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await PasswordResetRequest.findById(_id).populate(populateFor(JOINED));
  return doc ? lift(doc, JOINED) : null;
};

/** The queue, newest first, pending before anything already dealt with. */
router.get(
  '/',
  requirePermission('password_resets.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const filter = {};

    if (req.query.status) {
      filter.status = String(req.query.status).toUpperCase();
    }
    /*
     * Searching matched the person's name as well as what they typed to sign
     * in, and the name lives on the account rather than on the request. The
     * matching accounts are found first and the queue narrowed to them, which
     * is what the join allowed the WHERE to do.
     */
    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      const users = await User.find({ $or: [{ full_name: term }, { username: term }] })
        .select('_id').lean();
      filter.$or = [
        { submitted_login: term },
        { user_id: { $in: users.map((u) => u._id) } },
      ];
    }

    /*
     * Pending first, then newest. The CASE was an ordering, not a value: it
     * put anything still waiting above anything already dealt with. A sort on
     * status alone would not — 'COMPLETED' sorts before 'PENDING' — so the
     * rank is computed and sorted on.
     */
    const [docs, total] = await Promise.all([
      PasswordResetRequest.aggregate([
        { $match: filter },
        { $addFields: { pending_first: { $cond: [{ $eq: ['$status', 'PENDING'] }, 0, 1] } } },
        { $sort: { pending_first: 1, created_at: -1 } },
        { $skip: offset },
        { $limit: limit },
      ]).then((raw) => PasswordResetRequest.populate(raw, populateFor(JOINED))),
      PasswordResetRequest.countDocuments(filter),
    ]);
    const rows = lift(docs, JOINED);

    return paginated(res, rows, total, { page, limit });
  })
);

/** How many are waiting — for the badge on the dashboard. */
router.get(
  '/pending-count',
  requirePermission('password_resets.view'),
  asyncHandler(async (req, res) =>
    ok(res, { pending: await PasswordResetRequest.countDocuments({ status: 'PENDING' }) })
  )
);

/**
 * Complete a request: issue a temporary password.
 *
 * The password is returned once, in this response, for the member of staff to
 * write down and hand over. It is not stored in readable form anywhere, and the
 * account holder is forced to change it at their next sign-in.
 */
router.post(
  '/:id/complete',
  requirePermission('password_resets.manage'),
  validateBody(
    z.object({
      password: z
        .string()
        .min(8, 'A temporary password must be at least 8 characters')
        .max(100)
        .optional(),
      note: z.string().max(500).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const request = await loadRequest(id);
    if (!request) throw notFound('Reset request not found');
    if (request.status !== 'PENDING') throw badRequest('This request has already been dealt with.');

    const targetDoc = await User.findById(oid(request.user_id)).populate('role_id', 'code');
    const target = targetDoc ? lift(targetDoc, { role_id: { code: 'role_code' } }) : null;
    if (!target) throw notFound('The account no longer exists');
    assertMayReset(req.user, target);

    const password = req.body.password || `Vignan@${Math.floor(1000 + Math.random() * 9000)}`;
    await User.updateOne({ _id: oid(target.id) }, {
      $set: {
        password_hash: await hashPassword(password),
        must_change_password: 1,
        failed_attempts: 0,
        locked_until: null,
      },
    });
    // Any session opened with the old password is no longer trustworthy.
    await revokeAllUserTokens(target.id);

    await PasswordResetRequest.updateOne({ _id: oid(id) }, {
      $set: {
        status: 'COMPLETED',
        handled_by: oid(req.user.id),
        handled_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        handled_note: req.body.note?.trim() || null,
      },
    });

    await logActivity({
      req,
      action: 'PASSWORD_RESET',
      module: 'password_resets',
      entityType: 'User',
      entityId: target.id,
      description: `Issued a temporary password for "${target.username}"`,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'COMPLETED', requestId: id },
    });

    return ok(res, {
      id,
      user: { id: target.id, username: target.username, fullName: target.full_name },
      temporaryPassword: password,
      message: 'Hand this password to the account holder. They must change it when they sign in.',
    });
  })
);

/** Dismiss a request — a duplicate, or the person could not be identified. */
router.post(
  '/:id/reject',
  requirePermission('password_resets.manage'),
  validateBody(z.object({ note: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const request = await loadRequest(id);
    if (!request) throw notFound('Reset request not found');
    if (request.status !== 'PENDING') throw badRequest('This request has already been dealt with.');

    const targetDoc = await User.findById(oid(request.user_id)).populate('role_id', 'code');
    const target = targetDoc ? lift(targetDoc, { role_id: { code: 'role_code' } }) : null;
    if (target) assertMayReset(req.user, target);

    await PasswordResetRequest.updateOne({ _id: oid(id) }, {
      $set: {
        status: 'REJECTED',
        handled_by: oid(req.user.id),
        handled_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        handled_note: req.body.note?.trim() || null,
      },
    });

    await logActivity({
      req,
      action: 'UPDATE',
      module: 'password_resets',
      entityType: 'PasswordResetRequest',
      entityId: id,
      description: `Rejected the reset request for "${request.username}"`,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'REJECTED', note: req.body.note?.trim() || null },
    });

    return ok(res, { id, status: 'REJECTED' });
  })
);

export default router;
