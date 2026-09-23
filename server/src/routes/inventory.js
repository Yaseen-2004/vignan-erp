import { Router } from 'express';
import { Asset, InventoryCategory, InventoryItem, Purchase } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { lift, startsWith } from '../db/mongo/query.js';
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
    // An Admin with no campus of their own sees the whole institution;
    // everyone else is confined to theirs.
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? {} : { campus_id: oid(campusId) };

    /** COUNT / SUM over one collection, with COALESCE's zero for no rows. */
    const totals = async (Model, fields) => {
      const group = { _id: null, count: { $sum: 1 } };
      for (const [name, expr] of Object.entries(fields)) group[name] = { $sum: expr };
      const [row] = await Model.aggregate([{ $match: scope }, { $group: group }]);
      const out = { count: row?.count ?? 0 };
      for (const name of Object.keys(fields)) out[name] = row?.[name] ?? 0;
      return out;
    };

    const items = await totals(InventoryItem, {
      units: { $ifNull: ['$quantity', 0] },
      value: { $multiply: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$unit_cost', 0] }] },
    });

    const assets = await totals(Asset, { value: { $ifNull: ['$current_value', 0] } });

    /*
     * Stock at or below its reorder level. The comparison is between two
     * fields of the same document, which a plain filter cannot express — that
     * is what $expr is for.
     */
    const lowStock = lift(
      await InventoryItem.find({
        ...scope,
        $expr: { $lte: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$reorder_level', 0] }] },
      })
        .select('name item_code quantity reorder_level category_id')
        .populate('category_id', 'name')
        .sort({ quantity: 1 })
        .limit(20),
      { category_id: { name: 'category_name' } }
    );

    /*
     * Value by category, including the categories holding nothing.
     *
     * That is what the LEFT JOIN was for: a category with no stock still
     * appears, at zero. Grouping the items alone would silently drop it, and
     * an empty category is exactly what somebody reading this wants to see.
     */
    const categories = await InventoryCategory.find(scope).select('name').lean();
    const grouped = await InventoryItem.aggregate([
      { $match: scope },
      {
        $group: {
          _id: '$category_id',
          items: { $sum: 1 },
          value: { $sum: { $multiply: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$unit_cost', 0] }] } },
        },
      },
    ]);
    const byCategoryId = new Map(grouped.map((g) => [String(g._id), g]));
    const byCategory = categories
      .map((c) => ({
        category: c.name,
        items: byCategoryId.get(String(c._id))?.items ?? 0,
        value: byCategoryId.get(String(c._id))?.value ?? 0,
      }))
      .sort((a, b) => b.value - a.value);

    // Purchases this calendar year — the dates are stored as text, so the year
    // is matched on its first four characters, as the SQL did.
    const year = new Date().toISOString().slice(0, 4);
    const [purchases] = await Purchase.aggregate([
      { $match: { ...scope, purchase_date: startsWith(year) } },
      { $group: { _id: null, n: { $sum: { $ifNull: ['$total_cost', 0] } } } },
    ]);
    const purchasesYtd = purchases?.n ?? 0;

    return ok(res, { items, assets, lowStock, byCategory, purchasesYtd });
  })
);

export default router;
