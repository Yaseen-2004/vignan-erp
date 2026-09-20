/**
 * Translate the SQLite schema into PostgreSQL.
 *
 *   node src/db/to-postgres.mjs     writes schema.pg.sql beside schema.sql
 *
 * Kept as a script rather than a hand-edited second file so the two schemas
 * cannot drift: `schema.sql` stays the single description of the database, and
 * this states — in one place, reviewably — exactly how it maps onto Postgres.
 *
 * The translation is deliberately conservative. Timestamps stay TEXT holding
 * 'YYYY-MM-DD HH:MM:SS' rather than becoming `timestamptz`, because every
 * comparison, every API response and every test in this codebase treats them as
 * strings. Moving to a real date type is a worthwhile change, but it is a
 * different change from moving to a different database, and doing both at once
 * would make a failure impossible to attribute.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/** SQLite's datetime('now') is UTC; say so explicitly rather than inherit the
 *  server's timezone, so a cloud database in another region agrees with the
 *  timestamps already in the file. */
const UTC_STAMP = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')";
const UTC_DATE = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')";

export const RULES = [
  // Postgres has foreign keys on always.
  [/^PRAGMA .*;\s*$/gm, ''],

  // The rowid alias becomes a real sequence.
  [/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY'],

  // SQLite REAL is a 64-bit float; so is double precision. NUMERIC would be
  // more correct for money but comes back from pg as a string, which would
  // silently change arithmetic everywhere.
  [/\bREAL\b/g, 'DOUBLE PRECISION'],

  // Defaults.
  [/DEFAULT\s*\(\s*datetime\('now'\)\s*\)/gi, `DEFAULT ${UTC_STAMP}`],
  [/DEFAULT\s*\(\s*date\('now'\)\s*\)/gi, `DEFAULT ${UTC_DATE}`],
];

export function toPostgres(sql) {
  let out = sql;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

// Run directly rather than imported. `fileURLToPath` is what makes this work on
// Windows, where argv[1] is a drive path and import.meta.url is a file:/// URL.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const source = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');
  const converted = toPostgres(source);

  const header = `-- =====================================================================
-- GENERATED FILE — do not edit.
--   Source:    schema.sql
--   Generator: to-postgres.mjs
-- Edit schema.sql and re-run \`npm run db:pgschema -w server\`.
-- =====================================================================

`;
  fs.writeFileSync(path.join(dir, 'schema.pg.sql'), header + converted);

  // Report what changed, so a reviewer can see the translation is complete.
  const counts = RULES.map(([pattern]) => (source.match(pattern) || []).length);
  console.log('· schema.pg.sql written');
  console.log(`  ${counts[1]} identity columns, ${counts[2]} float columns,`
    + ` ${counts[3]} timestamp defaults, ${counts[4]} date defaults`);

  const leftovers = [
    ['AUTOINCREMENT', /AUTOINCREMENT/gi],
    ["datetime('now')", /datetime\('now'\)/gi],
    ["date('now')", /date\('now'\)/gi],
    ['PRAGMA', /PRAGMA/gi],
    ['sqlite_master', /sqlite_master/gi],
  ].map(([name, re]) => [name, (converted.match(re) || []).length]).filter(([, n]) => n);

  if (leftovers.length) {
    console.log('  UNTRANSLATED:', leftovers.map(([n, c]) => `${n} x${c}`).join(', '));
    process.exitCode = 1;
  } else {
    console.log('  no SQLite-only constructs remain');
  }
}
