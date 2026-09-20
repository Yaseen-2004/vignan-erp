/**
 * Schema migration / bootstrap.
 *
 *   npm run migrate -w server              apply the schema, sync permissions
 *   npm run migrate -w server -- --fresh   drop every table first
 *
 * The schema is applied from `schema.pg.sql`, which is generated from
 * `schema.sql` by `to-postgres.mjs`. Everything here is idempotent: running it
 * against a database that is already current changes nothing, which is what
 * makes it safe to run on every deploy.
 *
 * The one-time SQLite rebuilds that used to live here — widening the classes
 * unique key to include the board, narrowing attendance to PRESENT/ABSENT — are
 * gone. Both are simply how `schema.sql` describes those tables now, so a
 * database created from it is already in the finished shape. Data carried over
 * from the old SQLite file is corrected by `import-sqlite.js` instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import { ROLE_DEFINITIONS, ROLE_PERMISSIONS, MODULES, expand } from '../lib/permissions.js';
import { all, get, run, exec, refreshCatalogue, describe, close } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fresh = process.argv.includes('--fresh');

console.log(`\nMigrating ${describe()}\n`);

/* ------------------------------------------------------------------ reset */
if (fresh) {
  // Drop the schema rather than the file: on a managed database there is no
  // file, and the role usually may not drop the database itself.
  await exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('· dropped every table');
}

/* ----------------------------------------------------------------- schema */
const schema = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
await exec(schema);
await refreshCatalogue();
console.log('· schema applied');

/* ------------------------------------------------------------------ roles */
for (const role of ROLE_DEFINITIONS) {
  const existing = await get('SELECT id FROM roles WHERE code = ?', [role.code]);
  if (existing) {
    await run('UPDATE roles SET name = ?, description = ?, level = ?, is_system = 1 WHERE id = ?', [
      role.name,
      role.description,
      role.level,
      existing.id,
    ]);
  } else {
    await run('INSERT INTO roles (code, name, description, level, is_system) VALUES (?, ?, ?, ?, 1)', [
      role.code,
      role.name,
      role.description,
      role.level,
    ]);
  }
}
console.log(`· ${ROLE_DEFINITIONS.length} roles synced`);

/* ------------------------------------------------------------ permissions */
let permissionCount = 0;
for (const [module, def] of Object.entries(MODULES)) {
  for (const action of def.actions) {
    const code = `${module}.${action}`;
    const description = `${action[0].toUpperCase() + action.slice(1)} — ${def.label}`;
    const existing = await get('SELECT id FROM permissions WHERE code = ?', [code]);
    if (existing) {
      await run('UPDATE permissions SET module = ?, action = ?, description = ? WHERE id = ?', [
        module,
        action,
        description,
        existing.id,
      ]);
    } else {
      await run('INSERT INTO permissions (code, module, action, description) VALUES (?, ?, ?, ?)', [
        code,
        module,
        action,
        description,
      ]);
    }
    permissionCount += 1;
  }
}
console.log(`· ${permissionCount} permissions synced`);

/* ------------------------------------------------------- role permissions */
const permissionIds = new Map((await all('SELECT id, code FROM permissions')).map((p) => [p.code, p.id]));

for (const [roleCode, patterns] of Object.entries(ROLE_PERMISSIONS)) {
  const role = await get('SELECT id FROM roles WHERE code = ?', [roleCode]);
  if (!role) continue;
  const codes = expand(patterns);
  // Re-sync from the shipped matrix; custom grants live in user_permissions.
  await run('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
  for (const code of codes) {
    const permissionId = permissionIds.get(code);
    if (permissionId) {
      await run(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
        [role.id, permissionId]
      );
    }
  }
  console.log(`  · ${roleCode.padEnd(16)} ${codes.length} permissions`);
}

/* ---------------------------------------------------------- upload folders */
for (const dir of ['students', 'faculty', 'materials', 'documents', 'misc']) {
  fs.mkdirSync(path.join(env.uploadDir, dir), { recursive: true });
}

console.log(`\nDatabase ready: ${describe()}\n`);
await close();
