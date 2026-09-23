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
import mongoose from 'mongoose';
import { AcademicYear, CourseAssignment, Enrollment, ExamSubject, Examination, Mark, Notification, PushSubscription, RefreshToken, Result, SystemSetting, Timetable, byCollection } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { plain } from '../db/mongo/query.js';
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

/** A collection this build knows about. The models are the catalogue. */
const modelFor = (name) => byCollection[name] || null;

const rowsIn = async (table) => {
  const Model = modelFor(table);
  return Model ? Model.countDocuments({}) : 0;
};

/**
 * How much the database actually holds.
 *
 * `dbStats` is what Atlas bills against and what its console shows, so the
 * figure here matches the one the school will be quoted. `storageSize` counts
 * what the collections occupy on disk and `indexSize` the indexes over them —
 * together, the honest answer to "how much room are we using", rather than the
 * smaller `dataSize` which ignores both indexes and the space already claimed.
 */
async function databaseBytes() {
  try {
    const stats = await mongoose.connection.db.stats();
    return Number(stats.storageSize || 0) + Number(stats.indexSize || 0);
  } catch {
    // A user without the stats privilege is refused; the panel should still
    // draw, with the uploads figure it can get.
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
  const row = await SystemSetting.findOne({ key: 'storage_limit_mb' }).select('value').lean();
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
        (modelFor(table) ? { table, label, rows: await rowsIn(table) } : null))
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
      years: await yearsBreakdown(),
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
    count: async () => PushSubscription.countDocuments({ failures: { $gte: 5 } }),
    run: async () => (await PushSubscription.deleteMany({ failures: { $gte: 5 } })).deletedCount,
  },
  audit_logs: {
    label: 'Audit trail older than the chosen age',
    count: async (days) => await rowsOlderThan('activity_logs', 'created_at', days),
    run: async (days) => await deleteOlderThan('activity_logs', 'created_at', days),
  },
  notifications: {
    label: 'Notifications already read',
    count: async (days) => Notification.countDocuments({ is_read: 1, created_at: { $lt: cutoff(days) } }),
    run: async (days) =>
      (await Notification.deleteMany({ is_read: 1, created_at: { $lt: cutoff(days) } })).deletedCount,
  },
  sessions: {
    label: 'Expired sign-in sessions',
    // Expiry is written as an ISO instant by lib/auth.js, so comparing it as
    // text gives the same answer as comparing the instants.
    count: async () => RefreshToken.countDocuments({ expires_at: { $lt: new Date().toISOString() } }),
    run: async () =>
      (await RefreshToken.deleteMany({ expires_at: { $lt: new Date().toISOString() } })).deletedCount,
  },
  messages: {
    label: 'Messages older than the chosen age',
    count: async (days) => await rowsOlderThan('messages', 'created_at', days),
    run: async (days) => await deleteOlderThan('messages', 'created_at', days),
  },
};

/**
 * The day this many days ago, as the timestamps are written.
 *
 * Those are text, in a fixed format that sorts with the instants it denotes,
 * so "older than" is a string comparison — which is what substr() made of it
 * before.
 */
const cutoff = (days) =>
  new Date(Date.now() - Math.max(0, Number(days) || 0) * 86400000)
    .toISOString().slice(0, 10);

async function rowsOlderThan(table, column, days) {
  const Model = modelFor(table);
  return Model ? Model.countDocuments({ [column]: { $lt: cutoff(days) } }) : 0;
}

async function deleteOlderThan(table, column, days) {
  const Model = modelFor(table);
  if (!Model) return 0;
  return (await Model.deleteMany({ [column]: { $lt: cutoff(days) } })).deletedCount;
}

/**
 * What each academic year is carrying.
 *
 * Three correlated subqueries became three grouped queries — the years
 * themselves are few, but a count per year per measure is not.
 */
async function yearsBreakdown() {
  const years = plain(await AcademicYear.find({}).sort({ start_date: -1 }));
  const countByYear = async (Model) => {
    const rows = await Model.aggregate([{ $group: { _id: '$academic_year_id', n: { $sum: 1 } } }]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  };
  const [enrolments, slots, exams] = await Promise.all([
    countByYear(Enrollment),
    countByYear(Timetable),
    countByYear(Examination),
  ]);
  return years.map((y) => ({
    ...y,
    enrollments: enrolments.get(y.id) ?? 0,
    timetable_slots: slots.get(y.id) ?? 0,
    examinations: exams.get(y.id) ?? 0,
  }));
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

    /*
     * No VACUUM. PostgreSQL had to be told to reclaim the freed pages or the
     * file stayed the size it had grown to; MongoDB reuses that space itself,
     * and the equivalent (compact) takes the database offline while it runs —
     * not a trade worth making at the moment somebody has just tidied up.
     */

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
  validateBody(z.object({ academic_year_id: z.string().min(1), confirm: z.literal('CLEAR') })),
  asyncHandler(async (req, res) => {
    const yearId = oid(req.body.academic_year_id);
    const year = yearId ? plain(await AcademicYear.findById(yearId)) : null;
    if (!year) throw notFound('Academic year not found');
    if (year.is_current) throw badRequest('The current academic year cannot be cleared.');

    const removed = {};

    /*
     * Order matters: what refers to an examination goes before the
     * examination does. Nothing enforces that now — MongoDB would let a mark
     * outlive the exam it belongs to and simply read back as an orphan — so
     * the order is the guarantee, and it is worth keeping deliberate.
     *
     * The subqueries become two lookups: the examinations of this year, then
     * their subjects. Done once here rather than repeated inside each step.
     */
    const examinations = await Examination.find({ academic_year_id: yearId }).select('_id').lean();
    const examIds = examinations.map((x) => x._id);
    const examSubjects = examIds.length
      ? await ExamSubject.find({ examination_id: { $in: examIds } }).select('_id').lean()
      : [];
    const examSubjectIds = examSubjects.map((es) => es._id);

    const steps = [
      ['marks', Mark, { exam_subject_id: { $in: examSubjectIds } }],
      ['results', Result, { examination_id: { $in: examIds } }],
      ['exam_subjects', ExamSubject, { examination_id: { $in: examIds } }],
      ['examinations', Examination, { academic_year_id: yearId }],
      ['timetables', Timetable, { academic_year_id: yearId }],
      ['course_assignments', CourseAssignment, { academic_year_id: yearId }],
      ['enrollments', Enrollment, { academic_year_id: yearId }],
    ];

    for (const [name, Model, filter] of steps) {
      removed[name] = (await Model.deleteMany(filter)).deletedCount;
    }
    // No VACUUM: MongoDB reclaims space itself, and asking it to compact
    // blocks the database, which is not a trade a school wants at this moment.

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
