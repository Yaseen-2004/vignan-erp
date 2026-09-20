import { verifyAccessToken, loadUser, effectivePermissions } from '../lib/auth.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { asyncHandler } from '../lib/http.js';

/**
 * Check 1 — Authentication.
 * Populates req.user (full DB row + role) and req.permissions (a Set).
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = bearer || req.cookies?.access_token || null;
  if (!token) throw unauthorized('Sign in to continue');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    throw unauthorized(error.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid session');
  }

  const user = await loadUser(payload.sub);
  if (!user) throw unauthorized('Account no longer exists');
  if (user.status !== 'ACTIVE') throw forbidden(`Account is ${user.status.toLowerCase()}. Contact the administrator.`);

  req.user = user;
  req.permissions = await effectivePermissions(user);
  next();
});

/** Check 2 — Role. */
export function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role_code)) {
      return next(forbidden(`This area is restricted to: ${allowed.join(', ')}`));
    }
    next();
  };
}

/** Check 3 — Permission. Accepts one code or several (any-of). */
export function requirePermission(...codes) {
  const needed = codes.flat();
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const granted = needed.some((code) => req.permissions?.has(code));
    if (!granted) {
      return next(forbidden(`Missing permission: ${needed.join(' or ')}`));
    }
    next();
  };
}

/** Require every listed permission. */
export function requireAllPermissions(...codes) {
  const needed = codes.flat();
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const missing = needed.filter((code) => !req.permissions?.has(code));
    if (missing.length) return next(forbidden(`Missing permission: ${missing.join(', ')}`));
    next();
  };
}

export const hasPermission = (req, code) => !!req.permissions?.has(code);

/** Optional auth: attaches the user when a valid token is present, never fails. */
export const optionalAuth = async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : req.cookies?.access_token;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await loadUser(payload.sub);
    if (user && user.status === 'ACTIVE') {
      req.user = user;
      req.permissions = await effectivePermissions(user);
    }
  } catch {
    /* an invalid token on a public route is simply ignored */
  }
  next();
};
