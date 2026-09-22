/**
 * Who someone is, and what they may do.
 *
 * Ported to MongoDB. What each function *returns* is deliberately unchanged:
 * `loadUser` still hands back a flat record carrying `role_code` and
 * `campus_name` beside the user's own fields, because that is what the join
 * produced and what everything downstream — `publicUser`, the permission
 * middleware, the portal — reads. The query underneath is a populate; the
 * shape it yields is not allowed to differ.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { Administrator, Faculty, Parent, RefreshToken, RolePermission, Student, User, UserPermission } from '../db/mongo/models.js';
import { insensitive, lift, plain } from '../db/mongo/query.js';
import { oid } from '../db/mongo/connection.js';
import { ROLE_HOME } from './permissions.js';
import { boardOf } from './scope.js';

export const hashPassword = (plainText) => bcrypt.hash(plainText, env.bcryptRounds);
export const verifyPassword = (plainText, hash) => bcrypt.compare(plainText, hash);

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role_code },
    env.jwtSecret,
    { expiresIn: env.accessTokenTtl, issuer: 'vignan-erp' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret, { issuer: 'vignan-erp' });
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/*
 * Expiry is stored as an ISO instant, and compared as a string.
 *
 * That works only because every one of them is written by the line below, in
 * the same format and the same zone — ISO 8601 in UTC sorts the same way as the
 * instants it denotes. A single value written in another format would compare
 * wrongly and silently, so nothing else may write this field.
 */
const nowIso = () => new Date().toISOString();

export async function issueRefreshToken(userId, req) {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86400000).toISOString();
  await RefreshToken.create({
    user_id: oid(userId),
    token_hash: sha256(token),
    user_agent: req?.get?.('user-agent') || null,
    ip_address: req?.ip || null,
    expires_at: expiresAt,
  });
  return { token, expiresAt };
}

export async function consumeRefreshToken(token) {
  if (!token) return null;

  /*
   * Found and revoked in one operation.
   *
   * A refresh token is single use. Reading it, then revoking it in a second
   * call, leaves a gap in which two requests can both find it valid and both
   * be issued a session — which is precisely the replay that rotating tokens
   * exists to prevent. `findOneAndUpdate` makes the pair atomic, and only the
   * request that actually changed the row gets a session.
   */
  const row = await RefreshToken.findOneAndUpdate(
    { token_hash: sha256(token), revoked_at: null, expires_at: { $gt: nowIso() } },
    { $set: { revoked_at: nowIso() } },
    { new: false }
  );
  return row ? plain(row) : null;
}

export async function revokeRefreshToken(token) {
  if (!token) return 0;
  const result = await RefreshToken.updateOne(
    { token_hash: sha256(token), revoked_at: null },
    { $set: { revoked_at: nowIso() } }
  );
  return result.modifiedCount;
}

export async function revokeAllUserTokens(userId) {
  const result = await RefreshToken.updateMany(
    { user_id: oid(userId), revoked_at: null },
    { $set: { revoked_at: nowIso() } }
  );
  return result.modifiedCount;
}

/** The fields the old join lifted out of roles and campuses. */
const USER_JOIN = {
  role_id: { code: 'role_code', name: 'role_name', level: 'role_level' },
  campus_id: { name: 'campus_name', code: 'campus_code' },
};

/** Full user record with its role, in the shape the join returned. */
export async function loadUser(userId) {
  const _id = oid(userId);
  if (!_id) return null;
  const doc = await User.findById(_id).populate('role_id').populate('campus_id');
  return doc ? lift(doc, USER_JOIN) : null;
}

export async function findUserByLogin(login) {
  const pattern = insensitive(login);
  const doc = await User.findOne({ $or: [{ username: pattern }, { email: pattern }] })
    .populate('role_id')
    .populate('campus_id');
  return doc ? lift(doc, USER_JOIN) : null;
}

/**
 * Effective permissions = role grants + per-user ALLOW - per-user DENY.
 * Read fresh on every request, so a permission change takes effect at once.
 */
export async function effectivePermissions(user) {
  const [rolePerms, overrides] = await Promise.all([
    RolePermission.find({ role_id: oid(user.role_id) }).populate('permission_id', 'code'),
    UserPermission.find({ user_id: oid(user.id) }).populate('permission_id', 'code'),
  ]);

  const set = new Set(rolePerms.map((rp) => rp.permission_id?.code).filter(Boolean));
  for (const o of overrides) {
    const code = o.permission_id?.code;
    if (!code) continue;
    if (o.effect === 'ALLOW') set.add(code);
    else set.delete(code);
  }
  return set;
}

/** The profile record attached to a user, by what kind of person they are. */
export async function loadProfile(user) {
  const userId = oid(user.id);
  if (!userId) return null;

  switch (user.role_code) {
    case 'STUDENT': {
      const mapping = {
        class_id: { name: 'class_name' },
        section_id: { name: 'section_name' },
        academic_year_id: { name: 'academic_year' },
      };
      const doc = await Student.findOne({ user_id: userId })
        .populate('class_id', 'name')
        .populate('section_id', 'name')
        .populate('academic_year_id', 'name');
      return doc ? lift(doc, mapping) : null;
    }
    case 'PARENT': {
      const doc = await Parent.findOne({ user_id: userId });
      return doc ? plain(doc) : null;
    }
    case 'TEACHING_STAFF':
    case 'FINANCIAL_STAFF': {
      const doc = await Faculty.findOne({ user_id: userId }).populate('department_id', 'name');
      return doc ? lift(doc, { department_id: { name: 'department_name' } }) : null;
    }
    case 'ADMINISTRATOR': {
      const doc = await Administrator.findOne({ user_id: userId }).populate('department_id', 'name');
      return doc ? lift(doc, { department_id: { name: 'department_name' } }) : null;
    }
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
