/**
 * The database.
 *
 * One PostgreSQL, reached two ways:
 *
 *   DATABASE_URL set    a managed cloud Postgres (Neon, Supabase, RDS, Azure)
 *   DATABASE_URL unset  PGlite — PostgreSQL itself compiled to WebAssembly,
 *                       stored under data/, needing nothing installed
 *
 * Both are the same engine, so there is one SQL dialect in this codebase and no
 * branch anywhere else. Development and the tests run against real Postgres
 * without a server; production runs against the school's cloud database with
 * the same statements.
 *
 * Every helper is async. Call sites keep writing `?` placeholders — they are
 * translated to Postgres's numbered form here, which is what let 877 existing
 * queries move across untouched.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import env from '../config/env.js';

/* ------------------------------------------------------------ placeholders */
/**
 * `WHERE id = ?` becomes `WHERE id = $1`.
 *
 * Quoted text is skipped, so a literal question mark inside a string — a LIKE
 * pattern, a message body — is left alone rather than turned into a parameter.
 */
export function toNumbered(sql) {
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (quote) {
      out += c;
      // '' inside a string is an escaped quote, not the end of it.
      if (c === quote) {
        if (sql[i + 1] === quote) { out += sql[i + 1]; i += 1; } else quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (c === '?') { n += 1; out += `$${n}`; continue; }
    out += c;
  }
  return out;
}

/* ----------------------------------------------------------------- drivers */
const usingCloud = !!env.databaseUrl;
let pool = null;
let lite = null;

if (usingCloud) {
  const { default: pg } = await import('pg');

  // Managed providers terminate TLS with their own chain; `rejectUnauthorized`
  // is off because the certificate is theirs to rotate, not ours to pin. The
  // connection is still encrypted.
  const ssl = /\bsslmode=disable\b/.test(env.databaseUrl)
    ? false
    : { rejectUnauthorized: false };

  pool = new pg.Pool({
    connectionString: env.databaseUrl,
    ssl,
    max: env.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  // A pool that throws on an idle client would otherwise take the process down.
  pool.on('error', (error) => {
    console.error('· database pool error:', error.message);
  });
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = env.databaseDir;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  claimDataDir(dir);
  lite = await PGlite.create({ dataDir: dir });
}

/**
 * Claim the local data directory for this process.
 *
 * The local database is a single set of files with no server in front of it, so
 * exactly one process may have it open. Two would corrupt it.
 *
 * PGlite writes a `postmaster.pid`, but the pid in it comes from inside the
 * WebAssembly build and matches no real process — checking it against the
 * operating system says "not running" for a perfectly healthy server, which is
 * worse than not checking at all. So this keeps its own lock, holding the real
 * pid, and answers two different situations differently:
 *
 *   another live process holds it   refuse to start, and say which pid
 *   the holder is gone             take it over, clearing what it left
 *
 * A hard kill therefore recovers on the next start, while a second server
 * started by mistake is turned away instead of quietly corrupting the files.
 */
function claimDataDir(dir) {
  const ours = path.join(dir, 'vignan.lock');
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(ours)) {
    const holder = Number(String(fs.readFileSync(ours, 'utf8')).trim());
    if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && isRunning(holder)) {
      throw new Error(
        `The local database at ${dir} is already open in process ${holder}. `
        + 'Stop that server first, or point this one at another database with DATABASE_DIR.'
      );
    }
    // The holder is gone. Anything it left behind is stale by definition.
    fs.rmSync(ours, { force: true });
    fs.rmSync(path.join(dir, 'postmaster.pid'), { force: true });
    console.warn('· took over a database left locked by a process that is no longer running');
  }

  fs.writeFileSync(ours, String(process.pid));

  // Release it on the way out so the next start is clean. A hard kill skips
  // this, which is the case the takeover above exists for.
  const release = () => { try { fs.rmSync(ours, { force: true }); } catch { /* going away anyway */ } };
  process.once('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { release(); process.exit(0); });
  }
}

/** Whether a pid belongs to a process that still exists. */
function isRunning(pid) {
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else — still running.
    return error.code === 'EPERM';
  }
}

/** The connection a query should use: the open transaction's, or the pool. */
const inTransaction = new AsyncLocalStorage();

async function execute(sql, params) {
  const text = toNumbered(sql);
  const client = inTransaction.getStore();

  if (client) {
    const result = await client.query(text, params);
    return { rows: result.rows ?? [], changes: rowCount(result) };
  }
  if (pool) {
    const result = await pool.query(text, params);
    return { rows: result.rows ?? [], changes: rowCount(result) };
  }
  const result = await lite.query(text, params);
  return { rows: result.rows ?? [], changes: rowCount(result) };
}

const rowCount = (result) => Number(result.rowCount ?? result.affectedRows ?? 0);

/** Statements with no parameters — DDL, schema files with several statements. */
export async function exec(sql) {
  const client = inTransaction.getStore();
  if (client) return client.exec ? client.exec(sql) : client.query(sql);
  if (pool) return pool.query(sql);
  return lite.exec(sql);
}

/* ----------------------------------------------------------------- queries */

/** Run a query returning many rows. */
export async function all(sql, params = []) {
  const { rows } = await execute(sql, params);
  return rows;
}

/** Run a query returning a single row (or undefined). */
export async function get(sql, params = []) {
  const { rows } = await execute(sql, params);
  return rows[0];
}

/** Run a statement; returns { changes }. */
export async function run(sql, params = []) {
  const { rows, changes } = await execute(sql, params);
  // A statement written with RETURNING still hands back its id, which is how
  // the one caller that wants an insert id gets it.
  return { changes, lastInsertRowid: rows[0]?.id, rows };
}

/** Single scalar value from the first column of the first row. */
export async function scalar(sql, params = []) {
  const { rows } = await execute(sql, params);
  if (!rows.length) return undefined;
  return Object.values(rows[0])[0];
}

/**
 * Wrap a function so its statements commit or roll back together.
 *
 * The open client is held in async-local storage, so every `get`/`run`/`insert`
 * inside the callback goes to the same connection without being passed one.
 * Without that, a pooled `BEGIN` and the statements after it can land on
 * different connections and the transaction silently does nothing.
 */
export function transaction(fn) {
  return async (...args) => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await inTransaction.run(client, () => fn(...args));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* already closed */ }
        throw error;
      } finally {
        client.release();
      }
    }

    // PGlite is a single connection, so the "client" is the database itself.
    await lite.query('BEGIN');
    try {
      const result = await inTransaction.run(lite, () => fn(...args));
      await lite.query('COMMIT');
      return result;
    } catch (error) {
      try { await lite.query('ROLLBACK'); } catch { /* already closed */ }
      throw error;
    }
  };
}

/* ------------------------------------------------------------------ writes */

/** Build an INSERT from an object; returns the new row id. */
export async function insert(table, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) throw new Error(`insert(${table}) called with no columns`);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')})`
    + ` VALUES (${placeholders}) RETURNING id`;
  const { rows } = await execute(sql, keys.map((k) => normalise(data[k])));
  return rows[0]?.id;
}

/** Build an UPDATE ... WHERE id = ?; returns number of changed rows. */
export async function update(table, id, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined && k !== 'id');
  if (!keys.length) return 0;
  const sets = keys.map((k) => `"${k}" = ?`).join(', ');
  const stamp = tableHasColumn(table, 'updated_at')
    ? `, updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')`
    : '';
  const sql = `UPDATE "${table}" SET ${sets}${stamp} WHERE id = ?`;
  const { changes } = await execute(sql, [...keys.map((k) => normalise(data[k])), id]);
  return changes;
}

export async function remove(table, id) {
  const { changes } = await execute(`DELETE FROM "${table}" WHERE id = ?`, [id]);
  return changes;
}

/** Coerce a JS value to something the driver can bind. */
export function normalise(value) {
  if (value === undefined || value === '') return null;
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/* ------------------------------------------------------------- catalogue */
/**
 * Column metadata, read once at startup.
 *
 * `createResourceRouter` asks which columns a table has while it is being
 * built — during module evaluation, where nothing can be awaited. Loading the
 * catalogue in a top-level await here means it is already in hand by the time
 * any module that imports this one begins to run.
 */
const columnCache = new Map();

async function loadCatalogue() {
  columnCache.clear();
  const rows = await all(`
    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
           CASE WHEN k.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_pk
      FROM information_schema.columns c
      LEFT JOIN information_schema.table_constraints t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.constraint_type = 'PRIMARY KEY'
      LEFT JOIN information_schema.key_column_usage k
        ON k.constraint_name = t.constraint_name AND k.column_name = c.column_name
       AND k.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
     ORDER BY c.table_name, c.ordinal_position`);

  for (const row of rows) {
    if (!columnCache.has(row.table_name)) columnCache.set(row.table_name, []);
    columnCache.get(row.table_name).push({
      name: row.column_name,
      type: row.data_type,
      notNull: row.is_nullable === 'NO',
      default: row.column_default,
      pk: !!Number(row.is_pk),
    });
  }
  return columnCache.size;
}

/** Re-read the catalogue after the schema changes (migrations do this). */
export async function refreshCatalogue() {
  return loadCatalogue();
}

export function tableColumns(table) {
  return columnCache.get(table) || [];
}

export function tableHasColumn(table, column) {
  return tableColumns(table).some((c) => c.name === column);
}

export function clearColumnCache() {
  columnCache.clear();
}

/** Close the connection — used by scripts so the process can exit. */
export async function close() {
  if (pool) await pool.end();
  else if (lite) await lite.close();
}

/** Which database this process is talking to, for logs and the health check. */
export const describe = () =>
  usingCloud
    ? `cloud PostgreSQL (${redact(env.databaseUrl)})`
    : `local PostgreSQL (PGlite at ${env.databaseDir})`;

const redact = (url) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return 'configured';
  }
};

export const isCloud = usingCloud;

// The schema may not exist yet — on a first run `migrate` creates it and then
// refreshes this. An empty catalogue is not an error here.
await loadCatalogue().catch(() => 0);

export default { all, get, run, scalar, exec, transaction };
