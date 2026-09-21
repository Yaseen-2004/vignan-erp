/**
 * Time-limited links to stored files.
 *
 * Photographs, birth certificates, medical notes and everything else a school
 * holds about a child were served to anyone who knew the address. The names are
 * unguessable, which is not the same as private: a URL travels in browser
 * history, in a shared screenshot, in a forwarded message, in a referrer header,
 * and once it has travelled it works for ever and for everybody.
 *
 * So every link the API hands out now carries an expiry and a signature over
 * it. A link that leaks stops working; a link that is altered — a different
 * file, a later expiry — fails its signature.
 *
 * The signature is not tied to the person it was issued to, deliberately. A
 * class teacher and the office look at the same pupil's documents, a parent
 * opens a link in a different browser, and a per-person signature would break
 * all of that while a leaked link would still work until it expired. The
 * protection here is the clock, as it is for every object store's signed URLs.
 *
 * An <img> cannot send an Authorization header, which is why this is a
 * signature in the address rather than a token in a header.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';

/** Distinct from the token secret, so one cannot be used to forge the other. */
const KEY = crypto.createHash('sha256').update(`file-urls:${env.jwtSecret}`).digest();

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;   // a working day, so a page open since morning still shows its photographs

const digest = (path, expiry) =>
  crypto.createHmac('sha256', KEY).update(`${path}:${expiry}`).digest('base64url').slice(0, 27);

/** `/uploads/photos/x.jpg` -> `/uploads/photos/x.jpg?e=...&s=...` */
export function sign(path, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (typeof path !== 'string' || !path.startsWith('/uploads/')) return path;
  if (path.includes('?')) return path;                       // already signed
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${path}?e=${expiry}&s=${digest(path, expiry)}`;
}

/**
 * Is this request for `path` allowed?
 *
 * Compared in constant time: a comparison that stops at the first wrong
 * character tells an attacker how much of a guess was right.
 */
export function verify(path, expiry, signature) {
  if (!expiry || !signature) return false;
  const seconds = Number(expiry);
  if (!Number.isFinite(seconds) || seconds < Math.floor(Date.now() / 1000)) return false;

  const expected = digest(path, String(expiry));
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Sign every stored-file path on its way out.
 *
 * Done here rather than at each of the places that returns one: there are many,
 * they are added to, and the one that gets forgotten is the one that leaks. A
 * response is walked once and every `/uploads/...` string in it is signed,
 * whether it sits on a pupil, inside a list, or nested in a summary.
 */
export function signResponseUrls(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (payload) => json(walk(payload));
  next();
}

function walk(value, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (typeof value === 'string') return sign(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  if (typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, depth + 1);
    return out;
  }
  return value;
}
