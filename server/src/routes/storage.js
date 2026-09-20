/**
 * Storage and data retention — Admin only.
 *
 * A school ERP accumulates: every attendance mark, every notification, every
 * line of the audit trail. Left alone the database grows without bound, so the
 * Admin needs to see how big it has become, know when it is approaching the
 * limit they have set, and be able to clear data they no longer need.
 *
 * Nothing here deletes a person, a class or a fee. The purges are restricted to
 * records that are safe to lose once they are old — logs, read notifications,
 * expired sessions — and to whole past academic years, which is the one bulk
 * removal a school actually asks for. Every purge is counted before it runs,
 * confirmed by name, and written to the audit log.
 */
import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import env from '../config/env.js';
import { all, exec, get, run, scalar } from '../db/connection.js';
import { logActivity } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asyncHandler, ok } from '../lib/http.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { ROLES } from '../lib/permissions.js';

const router = Router();

// Managing storage is not something an Administrator does — it can destroy
// history for the whole school, so it sits with the Admin alongside settings.
router.use(requireRole(ROLES.ADMIN), requirePermission('settings.edit'));

/** 25 TB, in the megabytes the setting is stored in. */
const DEFAULT_LIMIT_MB = 26214400;

/** The tables worth showing, largest first — the ones that actually grow. */
const TRACKED = [
  ['activity_logs', 'Audit trail'],
  ['notifications', 'Notifications'],
  ['attendance', 'Student attendance'],
  ['marks', 'Marks'],
  ['results', 'Results'],
  ['timetables', 'Timetable slots'],
  ['messages', 'Messages'],
  ['fee_payments', 'Fee payments'],
  ['student_fees', 'Student fees'],
  ['faculty_attendance', 'Faculty attendance'],
  ['refresh_tokens', 'Sessions'],
  ['push_subscriptions', 'Device notifications'],
  ['students', 'Students'],
  ['users', 'User accounts'],
];

const tableExists = async (name) =>
  !!(await get(
    `SELECT 1 AS x FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?`,
    [name]
  ));

const rowsIn = async (table) => (await tableExists(table) ? Number(await scalar(`SELECT COUNT(*) FROM ${table}`) || 0) : 0);

/**
 * How much the database actually holds.
 *
 * `pg_database_size` is what the cloud provider bills against and what their
 * console shows, so the figure here matches the one the school will be quoted.
 * It counts indexes and table bloat as well as rows, which is the honest
 * answer to "how much room are we using".
 */
async function databaseBytes() {
  const size = Number(await scalar('SELECT pg_database_size(current_database())') || 0);
  if (size) return size;
  // A managed role without CONNECT-level introspection can be refused that;
  // summing the tables we know about is a reasonable second answer.
  try {
    return Number(await scalar(
      `SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(table_name))), 0)
         FROM information_schema.tables WHERE table_schema = 'public'`
    ) || 0);
  } catch {
    return 0;
  }
}

function uploadBytes() {
  let total = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* raced with a delete */
        }
      }
    }
  };
  walk(env.uploadDir);
  return total;
}

/** The configured ceiling, in bytes. */
async function limitBytes() {
  const row = await get("SELECT value FROM system_settings WHERE key = 'storage_limit_mb'");
  const mb = Number(row?.value);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_LIMIT_MB) * 1024 * 1024;
}

/* ===================================================================== */
/*  WHAT IS BEING STORED                                                 */
/* ===================================================================== */

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const database = await databaseBytes();
    const uploads = uploadBytes();
    const used = database + uploads;
    const limit = await limitBytes();

    const counted = await Promise.all(
      TRACKED.map(async ([table, label]) =>
        ((await tableExists(table)) ? { table, label, rows: await rowsIn(table) } : null))
    );
    const tables = counted.filter(Boolean).sort((a, b) => b.rows - a.rows);

    return ok(res, {
      database,
      uploads,
      used,
      limit,
      percent: limit ? Number(((used / limit) * 100).toFixed(1)) : 0,
      /** Warn before it becomes a problem rather than after. */
      state: used >= limit ? 'FULL' : used >= limit * 0.8 ? 'NEAR' : 'OK',
      tables,
      years: await all(
        `SELECT y.id, y.name, y.start_date, y.end_date, y.is_current,
                (SELECT COUNT(*) FROM enrollments e WHERE e.academic_year_id = y.id) AS enrollments,
                (SELECT COUNT(*) FROM timetables t WHERE t.academic_year_id = y.id) AS timetable_slots,
                (SELECT COUNT(*) FROM examinations x WHERE x.academic_year_id = y.id) AS examinations
           FROM academic_years y
          ORDER BY y.start_date DESC`
      ),
    });
  })
);

/* ===================================================================== */
/*  CLEARING WHAT IS NO LONGER NEEDED                                    */
/* ===================================================================== */

/**
 * The purges on offer.
 *
 * `count` says how much a purge would remove, so the Admin sees the number
 * before confirming rather than after. Each one is deliberately narrow: none of
 * them touches a person, a class, a fee or a result.
 */
const PURGES = {
  // A subscription the push service keeps refusing is dead in practice even
  // when it is never formally retired. Delivery prunes on 404 and 410; this
  // clears the ones that only ever fail.
  dead_devices: {
    label: 'Device notification registrations that keep failing',
    count: async () => Number(await scalar('SELECT COUNT(*) AS n FROM push_subscriptions WHERE failures >= 5') || 0),
    run: async () => (await run('DELETE FROM push_subscriptions WHERE failures >= 5')).changes,
  },
  audit_logs: {
    label: 'Audit trail older than the chosen age',
    count: async (days) => await rowsOlderThan('activity_logs', 'created_at', days),
    run: async (days) => await deleteOlderThan('activity_logs', 'created_at', days),
  },
  notifications: {
    label: 'Notifications already read',
    count: async (days) =>
      Number(
        await scalar(
          `SELECT COUNT(*) FROM notifications WHERE is_read = 1 AND substr(created_at, 1, 10) < to_char((now() AT TIME ZONE 'UTC') + (?)::interval, 'YYYY-MM-DD')`,
          [`-${days} days`]
        ) || 0
      ),
    run: async (days) =>
      (await run(`DELETE FROM notifications WHERE is_read = 1 AND substr(created_at, 1, 10) < to_char((now() AT TIME ZONE 'UTC') + (?)::interval, 'YYYY-MM-DD')`, [`-${days} days`]))
        .changes,
  },
  sessions: {
    label: 'Expired sign-in sessions',
    count: async () => Number(await scalar('SELECT COUNT(*) FROM refresh_tokens WHERE expires_at::timestamptz < now()') || 0),
    run: async () => (await run('DELETE FROM refresh_tokens WHERE expires_at::timestamptz < now()')).changes,
  },
  messages: {
    label: 'Messages older than the chosen age',
    count: async (days) => await rowsOlderThan('messages', 'created_at', days),
    run: async (days) => await deleteOlderThan('messages', 'created_at', days),
  },
};

async function rowsOlderThan(table, column, days) {
  if (!await tableExists(table)) return 0;
  return Number(await scalar(`SELECT COUNT(*) FROM ${table} WHERE substr(${column}, 1, 10) < to_char((now() AT TIME ZONE 'UTC') + (?)::interval, 'YYYY-MM-DD')`, [`-${days} days`]) || 0);
}

async function deleteOlderThan(table, column, days) {
  if (!await tableExists(table)) return 0;
  return (await run(`DELETE FROM ${table} WHERE substr(${column}, 1, 10) < to_char((now() AT TIME ZONE 'UTC') + (?)::interval, 'YYYY-MM-DD')`, [`-${days} days`])).changes;
}

/** What each purge would remove, so nothing is confirmed blind. */
router.get(
  '/purges',
  asyncHandler(async (req, res) => {
    const days = Math.max(0, Number(req.query.older_than_days) || 365);
    const options = await Promise.all(
      Object.entries(PURGES).map(async ([key, purge]) => ({
        key,
        label: purge.label,
        rows: await purge.count(days),
      }))
    );
    return ok(res, { olderThanDays: days, options });
  })
);

router.post(
  '/purge',
  validateBody(
    z.object({
      keys: z.array(z.enum(['audit_logs', 'notifications', 'sessions', 'messages'])).min(1, 'Choose what to clear'),
      older_than_days: z.coerce.number().int().min(0).max(3650).optional(),
      confirm: z.literal('CLEAR'),
    })
  ),
  asyncHandler(async (req, res) => {
    const days = req.body.older_than_days ?? 365;
    const removed = {};
    let total = 0;

    for (const key of req.body.keys) {
      const count = await PURGES[key].run(days);
      removed[key] = count;
      total += count;
    }

    // Reclaim the freed pages, or the file stays the size it grew to.
    await exec('VACUUM');

    await logActivity({
      req,
      action: 'DELETE',
      module: 'settings',
      entityType: 'Storage',
      description: `Cleared ${total} old record(s): ${req.body.keys.join(', ')} older than ${days} day(s)`,
      newValues: removed,
    });

    return ok(res, { removed, total, sizeAfter: await databaseBytes() });
  })
);

/**
 * Clear a whole past academic year.
 *
 * The one bulk removal a school genuinely asks for. The current year can never
 * be cleared, and pupils, staff and fee records are left alone — only the
 * year's own teaching records go.
 */
router.post(
  '/purge-year',
  validateBody(z.object({ academic_year_id: z.coerce.number().int().positive(), confirm: z.literal('CLEAR') })),
  asyncHandler(async (req, res) => {
    const year = await get('SELECT * FROM academic_years WHERE id = ?', [req.body.academic_year_id]);
    if (!year) throw notFound('Academic year not found');
    if (year.is_current) throw badRequest('The current academic year cannot be cleared.');

    const removed = {};
    // Order matters: the rows that reference an examination go before it does.
    const steps = [
      ['marks', `DELETE FROM marks WHERE exam_subject_id IN (
                   SELECT es.id FROM exam_subjects es
                    JOIN examinations x ON x.id = es.examination_id
                   WHERE x.academic_year_id = ?)`],
      ['results', `DELETE FROM results WHERE examination_id IN (
                     SELECT id FROM examinations WHERE academic_year_id = ?)`],
      ['exam_subjects', `DELETE FROM exam_subjects WHERE examination_id IN (
                           SELECT id FROM examinations WHERE academic_year_id = ?)`],
      ['examinations', 'DELETE FROM examinations WHERE academic_year_id = ?'],
      ['timetables', 'DELETE FROM timetables WHERE academic_year_id = ?'],
      ['course_assignments', 'DELETE FROM course_assignments WHERE academic_year_id = ?'],
      ['enrollments', 'DELETE FROM enrollments WHERE academic_year_id = ?'],
    ];

    for (const [name, sql] of steps) {
      if (!await tableExists(name)) continue;
      removed[name] = (await run(sql, [year.id])).changes;
    }
    await exec('VACUUM');

    await logActivity({
      req,
      action: 'DELETE',
      module: 'settings',
      entityType: 'Academic Year',
      entityId: year.id,
      description: `Cleared the teaching records of ${year.name}`,
      oldValues: { academic_year: year.name },
      newValues: removed,
    });

    return ok(res, { year: year.name, removed, sizeAfter: await databaseBytes() });
  })
);

export default router;
