/**
 * Prepare a database for real use.
 *
 * `seed` fills a database with an invented school — five hundred pupils who do
 * not exist, and one password printed in the output for all of them. It is for
 * looking around, and it must never be what a school starts from.
 *
 * This is the other beginning: the schema, one campus, and one administrator
 * whose password the school chooses. Nothing else. Pupils, staff and parents
 * come in afterwards through the import, which is the part that has been built
 * to check every row before it writes anything.
 *
 *   npm run bootstrap -w server
 *
 * It reads:
 *
 *   ADMIN_USERNAME   defaults to `admin`
 *   ADMIN_PASSWORD   required — there is no default, by design
 *   ADMIN_NAME       the person's name, for the top of the screen
 *   ADMIN_EMAIL      where a password reset would go
 *   SCHOOL_NAME      defaults to the application name
 *   SCHOOL_CODE      defaults to MAIN
 *
 * Running it twice is safe: it will not overwrite an administrator that is
 * already there, because the second run is usually a mistake and the first
 * one's password is in use.
 */
import { hashPassword } from '../lib/auth.js';
import env from '../config/env.js';
import { close, describe, get, insert, run } from './connection.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  ${name} is not set.\n`);
    console.error('  This creates the account the school signs in with, so its');
    console.error('  password has to be chosen rather than defaulted. Set it and');
    console.error('  run again:\n');
    console.error(`    ${name}='a long passphrase' npm run bootstrap -w server\n`);
    process.exit(1);
  }
  return value;
};

const username = process.env.ADMIN_USERNAME || 'admin';
const password = required('ADMIN_PASSWORD');

/*
 * The demo password is published in this repository and in the README. Someone
 * will reach for it out of habit; refusing it here costs a moment and saves an
 * administrator account that anyone who has read the documentation can open.
 */
if (password === 'Vignan@123') {
  console.error('\n  That is the demo password, which is published in this repository.');
  console.error('  Choose another one.\n');
  process.exit(1);
}
if (password.length < 10) {
  console.error('\n  Use at least ten characters. This account can read every');
  console.error('  record the school holds.\n');
  process.exit(1);
}

console.log(`\n  Database: ${describe()}\n`);

/* ------------------------------------------------------------------ roles */
const adminRole = await get("SELECT id FROM roles WHERE code = 'ADMIN'");
if (!adminRole) {
  console.error('  No roles found. Run the migration first:\n');
  console.error('    npm run migrate -w server\n');
  await close();
  process.exit(1);
}

/* --------------------------------------------------------------- existing */
const already = await get('SELECT username FROM users WHERE role_id = ? LIMIT 1', [adminRole.id]);
if (already) {
  console.log(`  An administrator already exists: ${already.username}`);
  console.log('  Nothing was changed. To reset a password, sign in and use the portal.\n');
  await close();
  process.exit(0);
}

/* ----------------------------------------------------------------- campus */
let campus = await get('SELECT id, name FROM campuses ORDER BY id LIMIT 1');
if (!campus) {
  const id = await insert('campuses', {
    code: process.env.SCHOOL_CODE || 'MAIN',
    name: process.env.SCHOOL_NAME || env.appName,
    status: 'ACTIVE',
  });
  campus = { id, name: process.env.SCHOOL_NAME || env.appName };
  console.log(`  Created campus: ${campus.name}`);
}

/* ------------------------------------------------------------ the account */
const userId = await insert('users', {
  campus_id: campus.id,
  role_id: adminRole.id,
  username,
  email: process.env.ADMIN_EMAIL || null,
  password_hash: await hashPassword(password),
  full_name: process.env.ADMIN_NAME || 'Administrator',
  status: 'ACTIVE',
});

// The first sign-in is worth recording; every later change to this account is.
await run(
  `INSERT INTO activity_logs (user_id, action, module, entity_type, entity_id, description)
   VALUES (?, 'CREATE', 'users', 'User', ?, ?)`,
  [userId, userId, `Administrator ${username} created by bootstrap`]
).catch(() => {});

console.log(`  Created administrator: ${username}`);
console.log('\n  The database holds no pupils, staff or parents. Bring them in');
console.log('  through Admin → Import, which reports every row before it writes.\n');

await close();
