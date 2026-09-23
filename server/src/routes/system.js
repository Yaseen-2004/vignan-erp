import { Router } from 'express';
import { z } from 'zod';
import { ActivityLog, SystemSetting, byCollection } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { escapeRegex, lift, plain } from '../db/mongo/query.js';
import { asyncHandler, ok, pagination, paginated } from '../lib/http.js';
import { notFound, forbidden, badRequest } from '../lib/errors.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logActivity, diff } from '../lib/audit.js';
import { isAdmin } from '../lib/scope.js';
import { ROLES } from '../lib/permissions.js';
import { createResourceRouter } from '../lib/crud.js';

const router = Router();

// =====================================================================
// AUDIT LOGS
// =====================================================================
router.get(
  '/audit-logs',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query, 50);
    const clauses = [];
    const params = [];

    if (!isAdmin(req.user) && req.user.campus_id) {
      clauses.push('(l.campus_id = ? OR l.campus_id IS NULL)');
      params.push(req.user.campus_id);
    }
    const filter = {};
    for (const field of ['user_id', 'action', 'module', 'entity_type', 'status', 'role_code']) {
      const value = req.query[field];
      if (value && value !== 'ALL') filter[field] = field === 'user_id' ? oid(value) : value;
    }

    /*
     * A date range over a timestamp stored as text.
     *
     * `substr(created_at, 1, 10) >= from` compared the day only. The same is
     * true of a string comparison here because the format is fixed and sorts
     * with the instants it denotes — and the upper bound carries \uffff so a
     * request "to" a given day includes everything recorded during it, rather
     * than stopping at midnight.
     */
    if (req.query.from) filter.created_at = { $gte: String(req.query.from) };
    if (req.query.to) {
      filter.created_at = { ...(filter.created_at || {}), $lte: `${String(req.query.to)}\uffff` };
    }

    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ description: term }, { user_name: term }, { action: term }];
    }

    const [docs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate('user_id', 'username')
        .sort({ created_at: -1, _id: -1 })
        .skip(offset)
        .limit(limit),
      ActivityLog.countDocuments(filter),
    ]);

    const rows = lift(docs, { user_id: { username: 'username' } }).map((row) => ({
      ...row,
      old_values: row.old_values ? safeParse(row.old_values) : null,
      new_values: row.new_values ? safeParse(row.new_values) : null,
    }));

    return paginated(res, rows, total, { page, limit });
  })
);

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Distinct values for the audit-log filter dropdowns. */
router.get(
  '/audit-logs/filters',
  requirePermission('audit.view'),
  asyncHandler(async (_req, res) =>
    ok(res, {
      actions: (await ActivityLog.distinct('action')).filter(Boolean).sort(),
      modules: (await ActivityLog.distinct('module')).filter(Boolean).sort(),
      roles: (await ActivityLog.distinct('role_code')).filter(Boolean).sort().map(
        (r) => r
      ),
    })
  )
);

router.get(
  '/audit-logs/:id',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const id = oid(req.params.id);
    const doc = id ? await ActivityLog.findById(id) : null;
    if (!doc) throw notFound('Log entry not found');
    const row = plain(doc);
    return ok(res, {
      ...row,
      old_values: row.old_values ? safeParse(row.old_values) : null,
      new_values: row.new_values ? safeParse(row.new_values) : null,
    });
  })
);

// =====================================================================
// SYSTEM SETTINGS — Admin only
// =====================================================================
router.get(
  '/settings',
  requirePermission('settings.view'),
  asyncHandler(async (req, res) => {
    // A campus's own settings and the ones that apply everywhere.
    const rows = lift(
      await SystemSetting.find({ $or: [{ campus_id: oid(req.user.campus_id) }, { campus_id: null }] })
        .populate('updated_by', 'full_name')
        .sort({ category: 1, key: 1 }),
      { updated_by: { full_name: 'updated_by_name' } }
    );
    const grouped = {};
    for (const row of rows) {
      grouped[row.category] ??= { category: row.category, settings: [] };
      grouped[row.category].settings.push(row);
    }
    return ok(res, Object.values(grouped));
  })
);

router.put(
  '/settings',
  requireRole(ROLES.ADMIN),
  requirePermission('settings.edit'),
  validateBody(
    z.object({
      settings: z
        .array(
          z.object({
            key: z.string().min(1).max(80),
            value: z.string().max(4000).nullable(),
            category: z.string().max(40).optional(),
            label: z.string().max(120).optional(),
            value_type: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON']).optional(),
            is_public: z.boolean().optional(),
          })
        )
        .min(1),
    })
  ),
  asyncHandler(async (req, res) => {
    const changes = [];
    for (const setting of req.body.settings) {
      const existingDoc = await SystemSetting.findOne({
        key: setting.key,
        $or: [{ campus_id: oid(req.user.campus_id) }, { campus_id: null }],
      });
      const existing = existingDoc ? plain(existingDoc) : null;
      if (existing) {
        if (String(existing.value ?? '') !== String(setting.value ?? '')) {
          changes.push({ key: setting.key, from: existing.value, to: setting.value });
        }
        await SystemSetting.updateOne({ _id: existingDoc._id }, {
          $set: {
            value: setting.value,
            label: setting.label ?? existing.label,
            value_type: setting.value_type ?? existing.value_type,
            is_public: setting.is_public ?? existing.is_public,
            updated_by: oid(req.user.id),
          },
        });
      } else {
        await SystemSetting.create({
          campus_id: oid(req.user.campus_id),
          category: setting.category || 'GENERAL',
          key: setting.key,
          value: setting.value,
          value_type: setting.value_type || 'STRING',
          label: setting.label || setting.key,
          is_public: setting.is_public ? 1 : 0,
          updated_by: oid(req.user.id),
        });
        changes.push({ key: setting.key, from: null, to: setting.value });
      }
    }

    if (changes.length) {
      await logActivity({
        req,
        action: 'SYSTEM_CHANGE',
        module: 'settings',
        entityType: 'System Setting',
        description: `Updated ${changes.length} system setting(s)`,
        oldValues: Object.fromEntries(changes.map((c) => [c.key, c.from])),
        newValues: Object.fromEntries(changes.map((c) => [c.key, c.to])),
      });
    }
    return ok(res, { updated: changes.length, changes });
  })
);

/** Health and footprint information for the Admin system page. */
router.get(
  '/health',
  requirePermission('settings.view'),
  asyncHandler(async (_req, res) => {
    const tables = [
      'users', 'students', 'parents', 'faculty', 'administrators', 'courses', 'attendance',
      'marks', 'results', 'fee_payments', 'activity_logs', 'notifications',
    ];
    // Counted together rather than one after another: twelve round trips to
    // draw one panel is twelve times the wait for no reason.
    const counted = await Promise.all(tables.map(async (table) => {
      const Model = byCollection[table];
      return [table, Model ? await Model.estimatedDocumentCount() : 0];
    }));
    const counts = Object.fromEntries(counted);

    return ok(res, {
      status: 'healthy',
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      counts,
      generatedAt: new Date().toISOString(),
    });
  })
);

// =====================================================================
// DOCUMENTS (generic)
// =====================================================================
router.use(
  '/documents',
  createResourceRouter({
    table: 'documents',
    module: 'documents',
    entityType: 'Document',
    populate: { uploaded_by: { full_name: 'uploaded_by_name' } },
    searchable: ['title', 'document_type', 'file_name'],
    filterable: ['owner_type', 'owner_id', 'document_type', 'verified'],
    sortable: ['id', 'created_at', 'title'],
    defaultSort: 'created_at',
    readOnly: false,
  })
);

export default router;
