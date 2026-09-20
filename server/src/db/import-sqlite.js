/**
 * Move the school's existing records out of the old SQLite file and into
 * PostgreSQL.
 *
 *   npm run db:import -w server                     from server/data/vignan_erp.db
 *   npm run db:import -w server -- --file <path>    from somewhere else
 *   npm run db:import -w server -- --dry            read and report, write nothing
 *
 * Run `npm run migrate -w server` first: this fills a schema, it does not
 * create one. Every table it touches is emptied before loading, so the import
 * can be repeated after a failure without doubling anything up.
 *
 * Table order is worked out from the foreign keys rather than hard-coded, so a
 * table added to the schema later is imported in the right place without this
 * file having to be edited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import env from '../config/env.js';
import { all, exec, run, describe, close } from './connection.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const fileArg = args.indexOf('--file');
const source = fileArg !== -1 ? args[fileArg + 1] : env.databaseFile;

if (!fs.existsSync(source)) {
  console.error(`\nNo SQLite database at ${path.resolve(source)}`);
  console.error('Point at it with:  npm run db:import -w server -- --file <path>\n');
  process.exit(1);
}

console.log(`\nImporting ${path.resolve(source)}`);
console.log(`        → ${describe()}${dry ? '   (dry run — nothing will be written)' : ''}\n`);

const sqlite = new DatabaseSync(source, { readOnly: true });

/* ------------------------------------------------------------ the order */
/** Tables in the target, and which other tables each one points at. */
const targetTables = (await all(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
)).map((r) => r.table_name);

const references = await all(`
  SELECT tc.table_name  AS child,
         kcu.column_name AS child_column,
         ccu.table_name  AS parent,
         ccu.column_name AS parent_column,
         c.is_nullable   AS nullable
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.columns c
      ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name
     AND c.column_name = kcu.column_name
   WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);

/** Foreign keys grouped by the table that holds them. */
const foreignKeys = new Map();
for (const fk of references) {
  if (!foreignKeys.has(fk.child)) foreignKeys.set(fk.child, []);
  foreignKeys.get(fk.child).push(fk);
}

/** Parents before children, so a row's references already exist when it lands. */
function loadOrder(tables, edges) {
  const parentsOf = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of edges) {
    if (child !== parent && parentsOf.has(child)) parentsOf.get(child).add(parent);
  }
  const ordered = [];
  const placed = new Set();
  // Repeatedly take whatever has all its parents already placed.
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !placed.has(t)
      && [...parentsOf.get(t)].every((p) => placed.has(p) || !parentsOf.has(p)));
    if (!ready.length) {
      // A cycle — self-references or a mutual pair. Take the rest as they come;
      // the deferred constraint check at commit time is what catches a genuine
      // problem, and these tables reference each other by nullable columns.
      ordered.push(...tables.filter((t) => !placed.has(t)));
      break;
    }
    for (const t of ready) { ordered.push(t); placed.add(t); }
  }
  return ordered;
}

const order = loadOrder(targetTables, references);

/* ------------------------------------------------------------- the copy */
const sourceTables = new Set(
  sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
);

const columnsOf = (table) =>
  sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);

const targetColumns = new Map();
for (const row of await all(
  `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
)) {
  if (!targetColumns.has(row.table_name)) targetColumns.set(row.table_name, new Set());
  targetColumns.get(row.table_name).add(row.column_name);
}

let totalRows = 0;
const skipped = [];
const loaded = [];
const repairs = [];

if (!dry) {
  // Empty everything first so a repeated run cannot double up. One statement,
  // so the order does not matter and the sequences reset with it.
  await exec(`TRUNCATE TABLE ${order.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  console.log('· target tables emptied\n');
}

for (const table of order) {
  if (!sourceTables.has(table)) { skipped.push(`${table} (not in the old database)`); continue; }

  // Only columns both sides agree on: the old file may carry a retired column,
  // and the schema may have gained one that simply has no old value.
  const shared = columnsOf(table).filter((c) => targetColumns.get(table)?.has(c));
  if (!shared.length) { skipped.push(`${table} (no columns in common)`); continue; }

  let rows = sqlite.prepare(`SELECT ${shared.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
  if (!rows.length) continue;

  // SQLite only enforces foreign keys when asked to, so an old file can hold a
  // row pointing at a record that no longer exists. Postgres will not take
  // those, and silently dropping them would be worse than saying so: a
  // reference that can be emptied is emptied, one that cannot costs the row,
  // and both are reported at the end.
  if (!dry) {
    for (const fk of foreignKeys.get(table) ?? []) {
      if (!shared.includes(fk.child_column)) continue;
      if (fk.parent === table) continue; // self-reference: the parent may be later in this same batch
      const present = new Set(
        (await all(`SELECT "${fk.parent_column}" AS id FROM "${fk.parent}"`)).map((r) => String(r.id))
      );
      const before = rows.length;
      if (fk.nullable === 'YES') {
        let emptied = 0;
        rows = rows.map((row) => {
          const value = row[fk.child_column];
          if (value === null || value === undefined || present.has(String(value))) return row;
          emptied += 1;
          return { ...row, [fk.child_column]: null };
        });
        if (emptied) repairs.push(`${table}.${fk.child_column}: ${emptied} reference(s) emptied (target missing)`);
      } else {
        rows = rows.filter((row) => {
          const value = row[fk.child_column];
          return value === null || value === undefined || present.has(String(value));
        });
        const dropped = before - rows.length;
        if (dropped) repairs.push(`${table}: ${dropped} row(s) dropped (${fk.child_column} target missing)`);
      }
    }
    if (!rows.length) continue;
  }

  const placeholders = `(${shared.map(() => '?').join(', ')})`;
  const columnList = shared.map((c) => `"${c}"`).join(', ');

  if (!dry) {
    // In batches: one statement per row would be thousands of round trips to a
    // cloud database, and a single statement for 26,000 rows exceeds the
    // parameter limit.
    const perBatch = Math.max(1, Math.floor(1000 / shared.length));
    for (let i = 0; i < rows.length; i += perBatch) {
      const batch = rows.slice(i, i + perBatch);
      const values = batch.map(() => placeholders).join(', ');
      const params = batch.flatMap((row) => shared.map((c) => normaliseForPg(row[c], table, c)));
      await run(`INSERT INTO "${table}" (${columnList}) VALUES ${values}`, params);
    }
  }

  loaded.push([table, rows.length]);
  totalRows += rows.length;
  process.stdout.write(`· ${table.padEnd(26)} ${String(rows.length).padStart(7)} rows\n`);
}

/**
 * SQLite stores what it is given; Postgres has opinions.
 *
 * The one substantive change is attendance: the status column used to allow
 * LATE and LEAVE, and the school simplified it to PRESENT/ABSENT. A pupil
 * marked LATE did attend, and one on LEAVE did not — the same reading the
 * SQLite-era migration applied, kept here so an old file still imports.
 */
function normaliseForPg(value, table, column) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (table === 'attendance' && column === 'status') {
    if (value === 'LATE') return 'PRESENT';
    if (value === 'LEAVE') return 'ABSENT';
  }
  return value;
}

/* --------------------------------------------------------- the sequences */
// Every id was carried across as-is, so the sequences still point at 1 and the
// next insert would collide. Move each one past the highest id present.
if (!dry) {
  let bumped = 0;
  for (const [table] of loaded) {
    if (!targetColumns.get(table)?.has('id')) continue;
    const { rows: [seq] = [] } = await run(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                     GREATEST(COALESCE((SELECT MAX(id) FROM "${table}"), 0), 1)) AS value`
    );
    if (seq) bumped += 1;
  }
  console.log(`\n· ${bumped} id sequences moved past the imported rows`);
}

sqlite.close();
console.log(`\n${dry ? 'Would import' : 'Imported'} ${totalRows.toLocaleString('en-IN')} rows across ${loaded.length} tables.`);
if (repairs.length) {
  console.log(`\nThe old database held ${repairs.length} broken reference(s), repaired on the way in:`);
  for (const note of repairs) console.log(`  · ${note}`);
}
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  for (const note of skipped) console.log(`  · ${note}`);
}
console.log('');
await close();
