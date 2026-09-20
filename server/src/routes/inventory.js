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
    alias: 'ic',
    select: `ic.*, (SELECT COUNT(*) FROM inventory_items i WHERE i.category_id = ic.id) AS item_count`,
    searchable: ['ic.name', 'ic.code'],
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
    alias: 'i',
    select: `i.*, ic.name AS category_name, d.name AS department_name,
             (i.quantity * i.unit_cost) AS total_value,
             CASE WHEN i.quantity <= i.reorder_level THEN 1 ELSE 0 END AS needs_reorder`,
    joins: `JOIN inventory_categories ic ON ic.id = i.category_id
            LEFT JOIN departments d ON d.id = i.department_id`,
    searchable: ['i.name', 'i.item_code', 'i.vendor', 'i.location'],
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
    alias: 'p',
    select: `p.*, i.name AS linked_item_name, u.full_name AS recorded_by_name`,
    joins: `LEFT JOIN inventory_items i ON i.id = p.item_id LEFT JOIN users u ON u.id = p.recorded_by`,
    searchable: ['p.item_name', 'p.vendor', 'p.invoice_number', 'p.purchase_order'],
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
    alias: 'a',
    select: `a.*, d.name AS department_name, u.full_name AS assigned_to_name`,
    joins: `LEFT JOIN departments d ON d.id = a.department_id LEFT JOIN users u ON u.id = a.assigned_to`,
    searchable: ['a.name', 'a.asset_code', 'a.serial_number', 'a.vendor'],
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
