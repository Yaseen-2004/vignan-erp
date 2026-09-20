import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { get, all, run } from '../db/connection.js';
import { ROLE_HOME } from './permissions.js';
import { boardOf } from './scope.js';

export const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role_code, campus: user.campus_id, name: user.full_name },
    env.jwtSecret,
    { expiresIn: env.accessTokenTtl, issuer: 'vignan-erp' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret, { issuer: 'vignan-erp' });
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export async function issueRefreshToken(userId, req) {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86400000).toISOString();
  await run(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, sha256(token), req?.get?.('user-agent') || null, req?.ip || null, expiresAt]
  );
  return { token, expiresAt };
}

export async function consumeRefreshToken(token) {
  if (!token) return null;
  const row = await get(
    `SELECT * FROM refresh_tokens
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at::timestamptz > now()`,
    [sha256(token)]
  );
  if (!row) return null;
  // Rotate: a refresh token is single-use.
  await run("UPDATE refresh_tokens SET revoked_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [row.id]);
  return row;
}

export async function revokeRefreshToken(token) {
  if (!token) return 0;
  return (await run("UPDATE refresh_tokens SET revoked_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE token_hash = ?", [sha256(token)])).changes;
}

export async function revokeAllUserTokens(userId) {
  return (await run("UPDATE refresh_tokens SET revoked_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE user_id = ? AND revoked_at IS NULL", [
    userId,
  ])).changes;
}

/** Full user record joined with its role. */
export async function loadUser(userId) {
  return await get(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.level AS role_level,
            c.name AS campus_name, c.code AS campus_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN campuses c ON c.id = u.campus_id
      WHERE u.id = ?`,
    [userId]
  );
}

export async function findUserByLogin(login) {
  return await get(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.level AS role_level
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.username) = lower(?) OR lower(u.email) = lower(?)`,
    [login, login]
  );
}

/**
 * Effective permissions = role grants + per-user ALLOW overrides - per-user DENY overrides.
 * Read fresh from the database on every request so permission changes take effect at once.
 */
export async function effectivePermissions(user) {
  const rolePerms = (await all(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
    [user.role_id]
  )).map((r) => r.code);

  const overrides = await all(
    `SELECT p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?`,
    [user.id]
  );

  const set = new Set(rolePerms);
  for (const o of overrides) {
    if (o.effect === 'ALLOW') set.add(o.code);
    else set.delete(o.code);
  }
  return set;
}

/** The profile row (student / faculty / parent / administrator) attached to a user. */
export async function loadProfile(user) {
  switch (user.role_code) {
    case 'STUDENT':
      return await get(
        `SELECT s.*, c.name AS class_name, sec.name AS section_name, ay.name AS academic_year
           FROM students s
           LEFT JOIN classes c ON c.id = s.class_id
           LEFT JOIN sections sec ON sec.id = s.section_id
           LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
          WHERE s.user_id = ?`,
        [user.id]
      );
    case 'PARENT':
      return await get('SELECT * FROM parents WHERE user_id = ?', [user.id]);
    case 'TEACHING_STAFF':
    case 'FINANCIAL_STAFF':
      return await get(
        `SELECT f.*, d.name AS department_name
           FROM faculty f LEFT JOIN departments d ON d.id = f.department_id
          WHERE f.user_id = ?`,
        [user.id]
      );
    case 'ADMINISTRATOR':
      return await get(
        `SELECT a.*, d.name AS department_name
           FROM administrators a LEFT JOIN departments d ON d.id = a.department_id
          WHERE a.user_id = ?`,
        [user.id]
      );
    default:
      return null;
  }
}

/** Shape sent to the client after login / on /auth/me. */
export async function publicUser(user, permissions, profile) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    photo: user.photo,
    gender: user.gender,
    status: user.status,
    mustChangePassword: !!user.must_change_password,
    role: user.role_code,
    roleName: user.role_name,
    roleLevel: user.role_level,
    campusId: user.campus_id,
    campusName: user.campus_name,
    /**
     * The department this account is confined to, or null when unrestricted.
     * Presentation only — the API narrows every query regardless.
     */
    board: await boardOf(user),
    lastLoginAt: user.last_login_at,
    home: ROLE_HOME[user.role_code] || '/',
    permissions: [...(permissions || [])],
    profile: profile || null,
  };
}
