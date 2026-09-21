/**
 * What is not ready for real use.
 *
 * A deployment fails in two ways. It refuses to start, which is obvious and
 * gets fixed; or it starts, works in a demonstration, and turns out weeks later
 * to have been keeping the school's files on a disk that is wiped at every
 * release. This reports the second kind before anyone depends on it.
 *
 *   npm run preflight -w server
 *
 * Nothing here changes anything. It reads configuration and the database and
 * says what it finds.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import { close, describe, get } from './connection.js';
import { usingObjectStorage } from '../lib/files.js';

const lines = [];
let blocking = 0;
let advisory = 0;

const ok = (what, detail = '') => lines.push(`  ok       ${what}${detail ? ` — ${detail}` : ''}`);
const warn = (what, why) => { advisory += 1; lines.push(`  check    ${what}\n             ${why}`); };
const stop = (what, why) => { blocking += 1; lines.push(`  BLOCKS   ${what}\n             ${why}`); };

console.log('\n  Readiness\n');

/* ------------------------------------------------------------- database */
if (env.databaseUrl) ok('database', describe());
else stop('database', 'DATABASE_URL is not set. The local database keeps files on disk, which most hosts discard at every deploy.');

/* ---------------------------------------------------------------- files */
if (usingObjectStorage) ok('uploaded files', 'object storage');
else warn('uploaded files',
  'S3_BUCKET is not set, so photographs and documents go to local disk. On a host that replaces its filesystem each deploy they will disappear, and the records pointing at them will not.');

/* -------------------------------------------------------------- secrets */
const weak = (value, name) => {
  if (!value) return stop(name, 'not set');
  if (value.length < 32) return warn(name, `only ${value.length} characters; use at least 32 of randomness`);
  if (/^(secret|changeme|password|replace)/i.test(value)) return stop(name, 'looks like a placeholder');
  return ok(name);
};
weak(process.env.JWT_SECRET, 'JWT_SECRET');
weak(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');
if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
  stop('token secrets', 'both are the same, so a refresh token would be accepted as an access token');
}

/* -------------------------------------------------------- notifications */
if (env.vapidPublicKey && env.vapidPrivateKey) ok('device notifications', 'configured');
else warn('device notifications', 'VAPID keys are not set, so nothing will reach a phone. Generate with: npm run push:keys -w server');

/* ------------------------------------------------------------- accounts */
try {
  const demo = await get("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
  const seeded = await get("SELECT id FROM students LIMIT 1");
  if (seeded) {
    warn('demo data', 'This database holds seeded pupils who do not exist, and every demo account shares one published password. Start a real school with: npm run setup:production -w server');
  } else if (demo) {
    ok('accounts', 'an administrator exists and no demo pupils are present');
  } else {
    stop('accounts', 'no administrator exists, so nobody can sign in. Run: npm run bootstrap -w server');
  }
} catch {
  stop('schema', 'the tables are not there. Run: npm run migrate -w server');
}

/* --------------------------------------------------------------- origin */
if (env.isProd && env.corsOrigins.some((o) => o.startsWith('http://'))) {
  warn('CORS_ORIGINS', 'an http:// origin is allowed in production; the session cookie will not be sent to it over a secure connection');
}

console.log(lines.join('\n'));
console.log(
  blocking
    ? `\n  ${blocking} thing${blocking === 1 ? '' : 's'} would stop this working, ${advisory} worth checking.\n`
    : advisory
      ? `\n  Nothing blocking. ${advisory} worth checking before a school depends on it.\n`
      : '\n  Ready.\n'
);

await close();
process.exit(blocking ? 1 : 0);
