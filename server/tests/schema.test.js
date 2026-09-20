/**
 * The Postgres schema, checked against a real Postgres engine.
 *
 *   node tests/schema.test.js
 *
 * PGlite is PostgreSQL itself compiled to WebAssembly, so this is not a
 * simulation of the dialect — a statement that runs here runs on Neon, Supabase
 * or RDS. It means the move off SQLite can be verified before a cloud database
 * exists, rather than discovered against one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const dir = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(dir, '..', 'src', 'db', 'schema.pg.sql');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nVignan ERP — PostgreSQL schema\n');

const sql = fs.readFileSync(schemaFile, 'utf8');
const db = await PGlite.create();

const version = (await db.query('select version() as v')).rows[0].v;
console.log(`  engine: ${version.split(' on ')[0]}\n`);

/* --------------------------------------------------------------- apply */
let applyError = null;
try {
  await db.exec(sql);
} catch (error) {
  applyError = error;
  // Name the offending statement rather than just failing.
  const statements = sql.split(/;\s*$/m).map((s) => s.trim()).filter((s) => s && !s.startsWith('--'));
  const fresh = await PGlite.create();
  for (const [i, statement] of statements.entries()) {
    try {
      await fresh.exec(statement + ';');
    } catch (e) {
      console.log(`\n  first failure at statement ${i + 1}: ${e.message}`);
      console.log('  ' + statement.split('\n').slice(0, 8).join('\n  ') + '\n');
      break;
    }
  }
}
check('the schema applies to PostgreSQL', !applyError, applyError?.message);

if (applyError) {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}

/* -------------------------------------------------------------- shape */
const tables = (await db.query(
  `select table_name from information_schema.tables where table_schema = 'public'`
)).rows.map((r) => r.table_name);

// Counted from the file rather than written here, so adding a table does not
// mean remembering to update a number in a test.
const declared = (sql.match(/CREATE TABLE IF NOT EXISTS/gi) || []).length;
check(`every declared table exists (${declared})`, tables.length === declared,
  `declared ${declared}, found ${tables.length}`);

const indexes = (await db.query(`select indexname from pg_indexes where schemaname = 'public'`)).rows;
check('indexes are created', indexes.length >= 28, `found ${indexes.length}`);

// The website CMS was removed from the product; no copy should reappear here.
for (const gone of ['cms_pages', 'cms_news', 'gallery', 'cms_downloads']) {
  check(`${gone} is not in the schema`, !tables.includes(gone));
}

/* ------------------------------------------------------------ defaults */
await db.query(`insert into campuses (code, name) values ('TEST', 'Test Campus')`);
const campus = (await db.query('select * from campuses')).rows[0];

check(
  'created_at reads back in the same shape SQLite wrote',
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(campus.created_at),
  `got "${campus.created_at}"`
);
check('a timestamp default is a string, not a Date', typeof campus.created_at === 'string');
check('SERIAL hands back an id', campus.id === 1, `got ${campus.id}`);

const utc = (await db.query(
  `select to_char((now() at time zone 'UTC'), 'YYYY-MM-DD HH24:MI') as a,
          substr($1::text, 1, 16) as b`,
  [campus.created_at]
)).rows[0];
check('timestamps are UTC, as they were under SQLite', utc.a === utc.b, `${utc.a} vs ${utc.b}`);

/* ---------------------------------------------------------- behaviour */
// Money columns must arrive as numbers. NUMERIC would come back as a string and
// break every sum in the finance routes, which is why the schema uses float.
await db.query(`insert into campuses (code, name) values ('T2', 'Second')`);
const feeTable = tables.includes('fee_structures');
check('a money column exists to check', feeTable);
if (feeTable) {
  const moneyType = (await db.query(
    `select data_type from information_schema.columns
      where table_name = 'fee_structures' and column_name = 'amount'`
  )).rows[0];
  check(
    'money is double precision, so it arrives as a JS number',
    moneyType?.data_type === 'double precision',
    moneyType?.data_type
  );
}

// Foreign keys are enforced without a PRAGMA.
let fkRefused = false;
try {
  await db.query(`insert into users (username, password_hash, role_id) values ('x', 'y', 999999)`);
} catch {
  fkRefused = true;
}
check('foreign keys are enforced', fkRefused);

// CHECK constraints survived the translation.
let checkRefused = false;
try {
  await db.query(`insert into campuses (code, name, status) values ('T3', 'Bad', 'NONSENSE')`);
} catch {
  checkRefused = true;
}
check('CHECK constraints survived translation', checkRefused);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
