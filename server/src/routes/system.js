import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar } from '../db/connection.js';
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
    for (const [field, column] of [
      ['user_id', 'l.user_id'],
      ['action', 'l.action'],
      ['module', 'l.module'],
      ['entity_type', 'l.entity_type'],
      ['status', 'l.status'],
      ['role_code', 'l.role_code'],
    ]) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        clauses.push(`${column} = ?`);
        params.push(req.query[field]);
      }
    }
    if (req.query.from) {
      clauses.push("substr(l.created_at, 1, 10) >= ?");
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push("substr(l.created_at, 1, 10) <= ?");
      params.push(req.query.to);
    }
    if (req.query.search) {
      clauses.push('(l.description ILIKE ? OR l.user_name ILIKE ? OR l.action ILIKE ?)');
      const term = `%${req.query.search}%`;
      params.push(term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM activity_logs l ${where}`, params));
    const rows = (await all(
      `SELECT l.*, u.username FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
       ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )).map((row) => ({
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
      actions: (await all('SELECT DISTINCT action FROM activity_logs ORDER BY action')).map((r) => r.action),
      modules: (await all('SELECT DISTINCT module FROM activity_logs WHERE module IS NOT NULL ORDER BY module')).map((r) => r.module),
      roles: (await all('SELECT DISTINCT role_code FROM activity_logs WHERE role_code IS NOT NULL ORDER BY role_code')).map(
        (r) => r.role_code
      ),
    })
  )
);

router.get(
  '/audit-logs/:id',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM activity_logs WHERE id = ?', [Number(req.params.id)]);
    if (!row) throw notFound('Log entry not found');
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
    const rows = await all(
      `SELECT s.*, u.full_name AS updated_by_name FROM system_settings s
         LEFT JOIN users u ON u.id = s.updated_by
        WHERE s.campus_id = ? OR s.campus_id IS NULL
        ORDER BY s.category, s.key`,
      [req.user.campus_id]
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
      const existing = await get('SELECT * FROM system_settings WHERE key = ? AND (campus_id = ? OR campus_id IS NULL)', [
        setting.key,
        req.user.campus_id,
      ]);
      if (existing) {
        if (String(existing.value ?? '') !== String(setting.value ?? '')) {
          changes.push({ key: setting.key, from: existing.value, to: setting.value });
        }
        await update('system_settings', existing.id, {
          value: setting.value,
          label: setting.label ?? existing.label,
          value_type: setting.value_type ?? existing.value_type,
          is_public: setting.is_public ?? existing.is_public,
          updated_by: req.user.id,
        });
      } else {
        await insert('system_settings', {
          campus_id: req.user.campus_id,
          category: setting.category || 'GENERAL',
          key: setting.key,
          value: setting.value,
          value_type: setting.value_type || 'STRING',
          label: setting.label || setting.key,
          is_public: setting.is_public ? 1 : 0,
          updated_by: req.user.id,
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
    const counts = {};
    for (const table of tables) counts[table] = Number(await scalar(`SELECT COUNT(*) AS n FROM ${table}`));

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
