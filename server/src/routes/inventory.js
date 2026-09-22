import { Router } from 'express';
import { all, get, scalar } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { createResourceRouter } from '../lib/crud.js';
import { isAdmin } from '../lib/scope.js';

const router = Router();

router.use(
  '/categories',
  createResourceRouter({
    table: 'inventory_categories',
    module: 'inventory',
    entityType: 'Inventory Category',
    counts: { item_count: { from: 'inventory_items', on: 'category_id' } },
    searchable: ['name', 'code'],
    sortable: ['id', 'name'],
    required: ['code', 'name'],
    defaultSort: 'name',
  })
);

router.use(
  '/items',
  createResourceRouter({
    table: 'inventory_items',
    module: 'inventory',
    entityType: 'Inventory Item',
    populate: {
      category_id: { name: 'category_name' },
      department_id: { name: 'department_name' },
    },
    /** What the arithmetic and the CASE in the select worked out. */
    derive: (row) => ({
      total_value: Number(row.quantity || 0) * Number(row.unit_cost || 0),
      needs_reorder: Number(row.quantity ?? 0) <= Number(row.reorder_level ?? 0) ? 1 : 0,
    }),
    searchable: ['name', 'item_code', 'vendor', 'location'],
    filterable: ['category_id', 'status', 'condition_status', 'department_id'],
    sortable: ['id', 'name', 'quantity', 'purchase_date'],
    required: ['item_code', 'name', 'category_id'],
    defaultSort: 'name',
  })
);

router.use(
  '/purchases',
  createResourceRouter({
    table: 'purchases',
    module: 'inventory',
    entityType: 'Purchase',
    populate: {
      item_id: { name: 'linked_item_name' },
      recorded_by: { full_name: 'recorded_by_name' },
    },
    searchable: ['item_name', 'vendor', 'invoice_number', 'purchase_order'],
    filterable: ['status', 'item_id'],
    sortable: ['id', 'purchase_date', 'total_cost'],
    required: ['item_name'],
    defaultSort: 'purchase_date',
    beforeCreate: (data, req) => ({
      ...data,
      recorded_by: req.user.id,
      total_cost: data.total_cost ?? Number(data.quantity || 1) * Number(data.unit_cost || 0),
    }),
  })
);

router.use(
  '/assets',
  createResourceRouter({
    table: 'assets',
    module: 'inventory',
    entityType: 'Asset',
    populate: {
      department_id: { name: 'department_name' },
      assigned_to: { full_name: 'assigned_to_name' },
    },
    searchable: ['name', 'asset_code', 'serial_number', 'vendor'],
    filterable: ['status', 'asset_type', 'department_id', 'condition_status'],
    sortable: ['id', 'name', 'purchase_date', 'current_value'],
    required: ['asset_code', 'name'],
    defaultSort: 'name',
  })
);

router.get(
  '/summary',
  requirePermission('inventory.view'),
  asyncHandler(async (req, res) => {
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? '' : ' WHERE campus_id = ?';
    const p = scope ? [campusId] : [];

    const items = await get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS units,
              COALESCE(SUM(quantity * unit_cost), 0) AS value FROM inventory_items${scope}`,
      p
    );
    const assets = await get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(current_value), 0) AS value FROM assets${scope}`,
      p
    );
    const lowStock = await all(
      `SELECT i.id, i.name, i.item_code, i.quantity, i.reorder_level, ic.name AS category_name
         FROM inventory_items i JOIN inventory_categories ic ON ic.id = i.category_id
        WHERE i.quantity <= i.reorder_level${scope ? ' AND i.campus_id = ?' : ''}
        ORDER BY i.quantity LIMIT 20`,
      p
    );
    const byCategory = await all(
      `SELECT ic.name AS category, COUNT(i.id) AS items, COALESCE(SUM(i.quantity * i.unit_cost), 0) AS value
         FROM inventory_categories ic LEFT JOIN inventory_items i ON i.category_id = ic.id
        ${scope ? 'WHERE ic.campus_id = ?' : ''}
        GROUP BY ic.id ORDER BY value DESC`,
      p
    );
    const purchasesYtd = Number(
      await scalar(
        `SELECT COALESCE(SUM(total_cost), 0) AS n FROM purchases
          WHERE substr(purchase_date, 1, 4) = to_char((now() AT TIME ZONE 'UTC'), 'YYYY')${scope ? ' AND campus_id = ?' : ''}`,
        p
      )
    );

    return ok(res, { items, assets, lowStock, byCategory, purchasesYtd });
  })
);

export default router;
