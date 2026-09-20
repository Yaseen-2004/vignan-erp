import { Router } from 'express';
import { z } from 'zod';
import env from '../config/env.js';
import { get, run } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { unauthorized, badRequest, forbidden } from '../lib/errors.js';
import {
  findUserByLogin,
  verifyPassword,
  hashPassword,
  signAccessToken,
  issueRefreshToken,
  consumeRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  loadUser,
  effectivePermissions,
  loadProfile,
  publicUser,
} from '../lib/auth.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { loginLimiter } from '../middleware/ratelimit.js';
import { logActivity } from '../lib/audit.js';
import { childrenOf } from '../lib/scope.js';

const router = Router();

/**
 * The four doors into the system, exactly the four top-level sections of the
 * specification. The login page lets someone pick the one they belong to, and
 * the check happens here rather than in the browser: a portal that could be
 * talked past by editing a form field would not be a portal at all.
 */
export const PORTALS = {
  // One door per family. A pupil's records are reached through their parent,
  // so the student role is not offered here.
  PARENTS: { label: 'Parents', roles: ['PARENT'] },
  FACULTY: { label: 'Faculty', roles: ['TEACHING_STAFF', 'FINANCIAL_STAFF'] },
  ADMINISTRATOR: { label: 'Administrator', roles: ['ADMINISTRATOR'] },
  ADMIN: { label: 'Admin', roles: ['ADMIN'] },
};

/** The door a given role belongs to, for telling someone where to go instead. */
const portalForRole = (role) =>
  Object.entries(PORTALS).find(([, portal]) => portal.roles.includes(role))?.[1] ?? null;

const loginSchema = z.object({
  login: z.string().min(3, 'Enter your username or email').max(120),
  password: z.string().min(1, 'Enter your password').max(200),
  portal: z.enum(['PARENTS', 'FACULTY', 'ADMINISTRATOR', 'ADMIN']).optional(),
  remember: z.boolean().optional(),
});

/**
 * The session cookie.
 *
 * `lax` is right while the portal and the API share an origin: the cookie is
 * sent on ordinary navigation and withheld from other sites' requests.
 *
 * Hosting the portal separately — the site on a CDN, the API elsewhere — makes
 * every request cross-site, and a `lax` cookie is then simply not sent. Signing
 * in appears to work and the session evaporates on the next page load. That
 * deployment needs `none`, which browsers only honour on a secure connection,
 * so `secure` is forced rather than left to be forgotten.
 */
const refreshCookie = {
  httpOnly: true,
  sameSite: env.cookieSameSite,
  secure: env.isProd || env.cookieSameSite === 'none',
  path: '/api/auth',
};

/**
 * Unified login with automatic role detection.
 * The client is told where to go via `user.home`.
 */
router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { login, password } = req.body;
    const user = await findUserByLogin(login);

    // Same message either way — no account enumeration.
    const invalid = () => unauthorized('Invalid credentials. Please check your username and password.');

    if (!user) {
      await logActivity({ req, action: 'LOGIN', module: 'auth', description: `Failed login for "${login}"`, status: 'FAILED' });
      throw invalid();
    }

    if (user.locked_until && new Date(user.locked_until + 'Z') > new Date()) {
      throw forbidden('Account temporarily locked after repeated failed attempts. Try again later.');
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= env.maxLoginAttempts;
      await run(
        `UPDATE users SET failed_attempts = ?, locked_until = ${lock ? `to_char((now() AT TIME ZONE 'UTC') + (${env.lockoutMinutes} || ' minutes')::interval, 'YYYY-MM-DD HH24:MI:SS')` : 'NULL'} WHERE id = ?`,
        [attempts, user.id]
      );
      await logActivity({
        req,
        user,
        action: 'LOGIN',
        module: 'auth',
        description: `Failed login (attempt ${attempts})`,
        status: 'FAILED',
      });
      throw invalid();
    }

    if (user.status !== 'ACTIVE') {
      throw forbidden(`Your account is ${user.status.toLowerCase()}. Please contact the administrator.`);
    }

    // The chosen door must serve this account. Checked only once the password
    // is known to be right, so a wrong portal can never reveal which role a
    // username holds to somebody who does not already have its credentials.
    const chosen = req.body.portal ? PORTALS[req.body.portal] : null;
    if (chosen && !chosen.roles.includes(user.role_code)) {
      const belongs = portalForRole(user.role_code);
      await logActivity({
        req,
        user,
        action: 'LOGIN',
        module: 'auth',
        description: `Refused at the ${chosen.label} portal — the account is ${user.role_code}`,
        status: 'FAILED',
      });
      throw forbidden(
        belongs
          ? `This is the ${chosen.label} portal. Your account belongs to the ${belongs.label} portal — choose it above and sign in again.`
          : `This is the ${chosen.label} portal. Your account does not belong to it.`
      );
    }

    await run("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [
      user.id,
    ]);

    const fresh = await loadUser(user.id);
    const accessToken = signAccessToken(fresh);
    const { token: refreshToken } = await issueRefreshToken(fresh.id, req);

    res.cookie('refresh_token', refreshToken, {
      ...refreshCookie,
      maxAge: env.refreshTokenTtlDays * 86400000,
    });

    await logActivity({
      req,
      user: fresh,
      action: 'LOGIN',
      module: 'auth',
      description: chosen ? `Signed in at the ${chosen.label} portal` : 'Signed in',
    });

    const permissions = await effectivePermissions(fresh);
    const profile = await loadProfile(fresh);
    return ok(res, {
      accessToken,
      user: await publicUser(fresh, permissions, profile),
      children: fresh.role_code === 'PARENT' ? await childrenOf(fresh) : undefined,
    });
  })
);

/** Exchange a refresh token for a new access token (rotating the refresh token). */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token || req.body?.refreshToken;
    const record = await consumeRefreshToken(token);
    if (!record) throw unauthorized('Session expired. Please sign in again.');

    const user = await loadUser(record.user_id);
    if (!user || user.status !== 'ACTIVE') throw unauthorized('Account is not active');

    const accessToken = signAccessToken(user);
    const { token: nextRefresh } = await issueRefreshToken(user.id, req);
    res.cookie('refresh_token', nextRefresh, { ...refreshCookie, maxAge: env.refreshTokenTtlDays * 86400000 });

    return ok(res, {
      accessToken,
      user: await publicUser(user, await effectivePermissions(user), await loadProfile(user)),
    });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (token) await revokeRefreshToken(token);
    res.clearCookie('refresh_token', refreshCookie);
    if (req.get('authorization')) {
      try {
        // Best-effort audit — the token may already have expired.
        const { verifyAccessToken } = await import('../lib/auth.js');
        const payload = verifyAccessToken(req.get('authorization').slice(7));
        const user = await loadUser(payload.sub);
        await logActivity({ req, user, action: 'LOGOUT', module: 'auth', description: 'Signed out' });
      } catch {
        /* ignore */
      }
    }
    return ok(res, { success: true });
  })
);

/** Current session: user, permissions, profile and (for parents) their children. */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await loadProfile(req.user);
    return ok(res, {
      user: await publicUser(req.user, req.permissions, profile),
      children: req.user.role_code === 'PARENT' ? await childrenOf(req.user) : undefined,
    });
  })
);

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Password must contain letters and numbers');

router.post(
  '/change-password',
  authenticate,
  validateBody(
    z.object({
      currentPassword: z.string().min(1, 'Enter your current password'),
      newPassword: passwordSchema,
    })
  ),
  asyncHandler(async (req, res) => {
    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const valid = await verifyPassword(req.body.currentPassword, user.password_hash);
    if (!valid) throw badRequest('Your current password is incorrect');
    if (req.body.currentPassword === req.body.newPassword) {
      throw badRequest('The new password must differ from the current one');
    }

    const hash = await hashPassword(req.body.newPassword);
    await run("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [
      hash,
      user.id,
    ]);
    await revokeAllUserTokens(user.id);

    await logActivity({
      req,
      action: 'PASSWORD_CHANGE',
      module: 'auth',
      entityType: 'User',
      entityId: user.id,
      description: 'Changed own password',
    });
    return ok(res, { success: true, message: 'Password updated. Please sign in again on other devices.' });
  })
);

/**
 * Forgotten password.
 *
 * There is no mail server behind this deployment and an unverified reset link
 * would be worse than useless, so the request is queued for the school office
 * instead: staff identify the person at the counter or on the telephone and
 * issue a temporary password from the Password Resets page.
 *
 * The reply is deliberately identical whether or not the account exists — the
 * form must not become a way to discover usernames.
 */
router.post(
  '/forgot-password',
  loginLimiter,
  validateBody(
    z.object({
      login: z.string().min(3, 'Enter your username or email').max(120),
      contact: z.string().max(120).optional(),
      reason: z.string().max(500).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const login = req.body.login.trim();
    const user = await findUserByLogin(login);
    const generic = {
      success: true,
      message:
        'If that account exists, the school office has been notified. Please contact the office to collect your temporary password.',
    };

    if (!user) {
      await logActivity({
        req,
        action: 'PASSWORD_RESET_REQUEST',
        module: 'auth',
        description: `Reset requested for unknown account "${login}"`,
        status: 'FAILED',
      });
      return ok(res, generic);
    }

    // One open request per account: asking twice should not queue twice.
    const pending = await get(
      "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'PENDING'",
      [user.id]
    );
    if (pending) {
      await run('UPDATE password_reset_requests SET contact = COALESCE(?, contact), reason = COALESCE(?, reason) WHERE id = ?', [
        req.body.contact?.trim() || null,
        req.body.reason?.trim() || null,
        pending.id,
      ]);
      return ok(res, generic);
    }

    const result = await run(
      // RETURNING id is how the new row's id comes back — Postgres has no
      // equivalent of SQLite's implicit last-insert-rowid.
      `INSERT INTO password_reset_requests (user_id, submitted_login, contact, reason, ip_address)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [user.id, login, req.body.contact?.trim() || null, req.body.reason?.trim() || null, req.ip || null]
    );

    await logActivity({
      req,
      action: 'PASSWORD_RESET_REQUEST',
      module: 'auth',
      entityType: 'User',
      entityId: user.id,
      description: `Password reset requested for "${user.username}"`,
      newValues: { requestId: Number(result.lastInsertRowid) },
    });
    return ok(res, generic);
  })
);

/** Effective permission list — the client uses it to hide what the API would refuse. */
router.get(
  '/permissions',
  authenticate,
  asyncHandler(async (req, res) => ok(res, { permissions: [...req.permissions] }))
);

export default router;
