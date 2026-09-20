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
import { all, get, run, scalar } from '../db/connection.js';
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

const SELECT = `
  SELECT r.id, r.user_id, r.submitted_login, r.contact, r.reason, r.status,
         r.handled_at, r.handled_note, r.created_at,
         u.username, u.full_name, u.email, u.phone, u.status AS account_status,
         ro.code AS role_code, ro.name AS role_name,
         h.full_name AS handled_by_name
    FROM password_reset_requests r
    JOIN users u  ON u.id = r.user_id
    JOIN roles ro ON ro.id = u.role_id
    LEFT JOIN users h ON h.id = r.handled_by`;

/** The queue, newest first, pending before anything already dealt with. */
router.get(
  '/',
  requirePermission('password_resets.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const filters = [];
    const params = [];

    if (req.query.status) {
      filters.push('r.status = ?');
      params.push(String(req.query.status).toUpperCase());
    }
    if (req.query.search) {
      filters.push('(u.full_name ILIKE ? OR u.username ILIKE ? OR r.submitted_login ILIKE ?)');
      const like = `%${req.query.search}%`;
      params.push(like, like, like);
    }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';

    const total = await scalar(
      `SELECT COUNT(*) FROM password_reset_requests r JOIN users u ON u.id = r.user_id${where}`,
      params
    );
    const rows = await all(
      `${SELECT}${where}
        ORDER BY CASE r.status WHEN 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, rows, total, { page, limit });
  })
);

/** How many are waiting — for the badge on the dashboard. */
router.get(
  '/pending-count',
  requirePermission('password_resets.view'),
  asyncHandler(async (req, res) =>
    ok(res, { pending: await scalar("SELECT COUNT(*) FROM password_reset_requests WHERE status = 'PENDING'") })
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
    const id = Number(req.params.id);
    const request = await get(`${SELECT} WHERE r.id = ?`, [id]);
    if (!request) throw notFound('Reset request not found');
    if (request.status !== 'PENDING') throw badRequest('This request has already been dealt with.');

    const target = await get('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [
      request.user_id,
    ]);
    if (!target) throw notFound('The account no longer exists');
    assertMayReset(req.user, target);

    const password = req.body.password || `Vignan@${Math.floor(1000 + Math.random() * 9000)}`;
    await run(
      `UPDATE users
          SET password_hash = ?, must_change_password = 1, failed_attempts = 0,
              locked_until = NULL, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
        WHERE id = ?`,
      [await hashPassword(password), target.id]
    );
    // Any session opened with the old password is no longer trustworthy.
    await revokeAllUserTokens(target.id);

    await run(
      `UPDATE password_reset_requests
          SET status = 'COMPLETED', handled_by = ?, handled_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'), handled_note = ?
        WHERE id = ?`,
      [req.user.id, req.body.note?.trim() || null, id]
    );

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
    const id = Number(req.params.id);
    const request = await get(`${SELECT} WHERE r.id = ?`, [id]);
    if (!request) throw notFound('Reset request not found');
    if (request.status !== 'PENDING') throw badRequest('This request has already been dealt with.');

    const target = await get('SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [
      request.user_id,
    ]);
    if (target) assertMayReset(req.user, target);

    await run(
      `UPDATE password_reset_requests
          SET status = 'REJECTED', handled_by = ?, handled_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'), handled_note = ?
        WHERE id = ?`,
      [req.user.id, req.body.note?.trim() || null, id]
    );

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
