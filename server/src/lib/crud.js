/**
 * The generic resource router.
 *
 * Forty-four resources are built on this, so what it gets right or wrong, it
 * gets right or wrong forty-four times — including the department ceiling that
 * keeps one wing of the school out of the other's records.
 *
 * Ported to MongoDB. Three things in the old interface were SQL and had to
 * become something else:
 *
 *   joins + select   ->  `populate`, a map of reference to the fields lifted
 *                        out of it. `JOIN classes c ... c.name AS class_name`
 *                        is `{ class_id: { name: 'class_name' } }`.
 *
 *   count subqueries ->  `counts`. `(SELECT COUNT(*) FROM classes WHERE
 *                        academic_year_id = ay.id) AS class_count` is
 *                        `{ class_count: { from: 'classes', on: 'academic_year_id' } }`.
 *
 *   boardColumn      ->  `board`. A record either carries its own department,
 *                        or reaches it through a reference — a section's
 *                        department is its class's. Both are declared rather
 *                        than written as a join.
 *
 * What it returns is unchanged: a flat record carrying `class_name` and
 * `class_count` beside its own fields, which is what the portal reads.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import { byCollection } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { escapeRegex, lift, plain, populateFor } from '../db/mongo/query.js';
import { asyncHandler, pagination, paginated, ok, created } from './http.js';
import { notFound, forbidden, badRequest } from './errors.js';
import { requirePermission } from '../middleware/auth.js';
import { logActivity, diff } from './audit.js';
import { boardOf, isAdmin, sameId } from './scope.js';

/**
 * A route parameter that is an identifier.
 *
 * It used to be `[0-9]+`, which kept literal sub-routes like `/pending` from
 * being swallowed by the detail route. An ObjectId is twenty-four hex
 * characters, so that pattern now matches nothing at all — every detail route
 * would have returned "not found" for every record, which is the kind of
 * breakage that looks like missing data rather than a broken route.
 */
export const ID_PARAM = '/:id([0-9a-fA-F]{24})';

export function createResourceRouter(options) {
  const {
    table,
    module,
    entityType = table,
    /** { reference: { fieldOnTarget: nameHere } } — what the join used to lift. */
    populate = {},
    /** { nameHere: { from, on, where?, sum? } } — the correlated COUNT/SUM subqueries. */
    counts = {},
    /**
     * Fields worked out from the record rather than fetched — what a CASE
     * expression in the select produced, such as whether a loan is overdue.
     * Given the row, it returns the fields to add to it.
     */
    derive = null,
    searchable = [],
    filterable = [],
    /**
     * Where this resource's department lives: a field on the record itself
     * (`'board'`), or one reached through a reference
     * (`{ via: 'class_id', field: 'board' }`).
     *
     * When set, a user assigned to one department can neither list nor write
     * records belonging to the other — the ?board= filter may narrow further
     * but never widens past this.
     */
    board = null,
    sortable = ['id'],
    writable,
    required = [],
    campusScoped = true,
    defaultSort = 'id',
    scopeFilter,
    canAccess,
    beforeCreate,
    beforeUpdate,
    afterCreate,
    afterUpdate,
    beforeDelete,
    readOnly = false,
    permissions = {},
  } = options;

  const Model = byCollection[table];
  if (!Model) throw new Error(`createResourceRouter: no collection named "${table}"`);

  const router = Router();

  const paths = Object.keys(Model.schema.paths);
  const columns = paths.map((p) => (p === '_id' ? 'id' : p));
  const writableColumns =
    writable || paths.filter((c) => !['_id', '__v', 'created_at', 'updated_at', 'campus_id', 'created_by'].includes(c));

  const perm = {
    view: permissions.view ?? `${module}.view`,
    create: permissions.create ?? `${module}.create`,
    edit: permissions.edit ?? `${module}.edit`,
    delete: permissions.delete ?? `${module}.delete`,
  };

  const hasCampus = paths.includes('campus_id');
  const references = new Set(
    paths.filter((p) => Model.schema.paths[p]?.options?.ref)
  );

  /** Values destined for a reference must be ObjectIds, not the strings they arrive as. */
  const coerce = (data) => {
    const out = { ...data };
    for (const key of Object.keys(out)) {
      if (references.has(key) && out[key] != null && out[key] !== '') {
        const id = oid(out[key]);
        if (!id) throw badRequest(`${key} is not a valid reference`);
        out[key] = id;
      } else if (out[key] === '') {
        out[key] = null;
      }
    }
    return out;
  };

  /* ================================================================== */
  /*  THE DEPARTMENT CEILING                                            */
  /* ================================================================== */

  /**
   * A filter confining a query to the user's department, or null.
   *
   * When the department lives on a referenced record — a section's is its
   * class's — the referenced ids are resolved first and the filter narrows to
   * those. It is an extra query, and it is what the join did.
   */
  async function boardFilter(user) {
    if (!board) return null;
    const wing = await boardOf(user);
    if (!wing) return null;

    if (typeof board === 'string') return { [board]: wing };

    // The department lives on a referenced record — a section's is its class's.
    const ref = Model.schema.paths[board.via]?.options?.ref;
    if (!ref) return null;
    const Via = mongoose.model(ref);

    const ids = await Via.find({ [board.field || 'board']: wing }).select('_id').lean();
    return { [board.via]: { $in: ids.map((r) => r._id) } };
  }

  /**
   * Refuse a write that would place a record in the other department.
   *
   * Reading is confined by the filter, but a create carries its own department:
   * either directly (a class has `board`) or through its parent (a section
   * belongs to a class, a course assignment to a section). Resolving it from
   * whichever key the payload carries covers both shapes without each resource
   * having to describe itself.
   */
  async function assertPayloadBoard(req, data) {
    if (!board) return;
    const wing = await boardOf(req.user);
    if (!wing) return;

    let value = data.board;
    const lookup = async (collection, id, path = 'board') => {
      const M = byCollection[collection];
      const _id = oid(id);
      if (!M || !_id) return null;
      const row = await M.findById(_id).select(path).lean();
      return row?.[path] ?? null;
    };

    if (!value && data.class_id) value = await lookup('classes', data.class_id);
    if (!value && data.section_id) {
      const section = await byCollection.sections?.findById(oid(data.section_id)).select('class_id').lean();
      if (section) value = await lookup('classes', section.class_id);
    }
    if (!value && data.course_id) {
      const course = await byCollection.courses?.findById(oid(data.course_id)).select('class_id').lean();
      if (course) value = await lookup('classes', course.class_id);
    }

    if (value && value !== wing) {
      throw forbidden(
        `You are assigned to the ${wing === 'CBSE' ? 'CBSE' : 'State Board'} department and cannot create or change records in the other one.`
      );
    }
  }

  /* ================================================================== */
  /*  READING                                                           */
  /* ================================================================== */

  /** The filter shared by list and detail. */
  async function buildScope(req) {
    const filter = {};

    if (campusScoped && hasCampus) {
      // Admin may inspect any campus; everyone else is pinned to their own.
      if (isAdmin(req.user)) {
        if (req.query.campus_id) filter.campus_id = oid(req.query.campus_id);
      } else if (req.user.campus_id) {
        filter.campus_id = oid(req.user.campus_id);
      }
    }

    // The department a user is confined to is a ceiling, not a preference.
    const confine = await boardFilter(req.user);
    if (confine) Object.assign(filter, confine);

    if (scopeFilter) Object.assign(filter, (await scopeFilter(req)) || {});
    return filter;
  }

  /** Attach the counts that were correlated subqueries. */
  async function withCounts(rows) {
    const names = Object.keys(counts);
    if (!names.length || !rows.length) return rows;

    const ids = rows.map((r) => oid(r.id)).filter(Boolean);
    for (const name of names) {
      /*
       * `where` narrows it, as the subquery's own WHERE did — the difference
       * between how many copies a book has and how many are out. `sum` totals
       * a field instead of counting rows, which is what COALESCE(SUM(x), 0)
       * asked for; absent rows give 0 either way, as the COALESCE ensured.
       */
      const { from, on, where = {}, sum = null } = counts[name];
      const M = byCollection[from];
      if (!M) { rows.forEach((r) => { r[name] = 0; }); continue; }

      // One grouped query per column rather than one per row: a page of
      // twenty-five would otherwise be twenty-five round trips per column.
      const grouped = await M.aggregate([
        { $match: { ...where, [on]: { $in: ids } } },
        {
          $group: {
            _id: `$${on}`,
            n: sum ? { $sum: { $ifNull: [`$${sum}`, 0] } } : { $sum: 1 },
          },
        },
      ]);
      const byId = new Map(grouped.map((g) => [String(g._id), g.n]));
      for (const row of rows) row[name] = byId.get(String(row.id)) ?? 0;
    }
    return rows;
  }

  /** Add the fields a CASE expression used to produce. */
  const withDerived = (rows) => {
    if (!derive) return rows;
    for (const row of rows) Object.assign(row, derive(row) || {});
    return rows;
  };

  /**
   * Fetch one record, already confined to the caller's department.
   *
   * Filtering the list is not enough: without this, a deep link to a record in
   * the other wing would still resolve. Applying the ceiling here means such a
   * record simply does not exist for that user, and `assertAccess` turns that
   * into the same "not found" any bad id gets.
   */
  async function fetchById(req, id) {
    const _id = oid(id);
    if (!_id) return null;

    const filter = { _id };
    const confine = await boardFilter(req.user);
    if (confine) Object.assign(filter, confine);

    const query = Model.findOne(filter);
    if (Object.keys(populate).length) query.populate(populateFor(populate));
    const doc = await query.exec();
    if (!doc) return null;

    const row = Object.keys(populate).length ? lift(doc, populate) : plain(doc);
    return withDerived(await withCounts([row]))[0];
  }

  async function assertAccess(req, row) {
    if (!row) throw notFound(`${entityType} not found`);
    if (
      campusScoped
      && hasCampus
      && !isAdmin(req.user)
      && req.user.campus_id
      && row.campus_id
      && !sameId(row.campus_id, req.user.campus_id)
    ) {
      throw forbidden('This record belongs to a different campus');
    }
    if (canAccess && !(await canAccess(req, row))) {
      throw forbidden(`You are not authorised to access this ${entityType.toLowerCase()}`);
    }
    return row;
  }

  // ------------------------------------------------------------ LIST
  router.get(
    '/',
    requirePermission(perm.view),
    asyncHandler(async (req, res) => {
      const { page, limit } = pagination(req.query);
      const filter = await buildScope(req);

      if (req.query.search && searchable.length) {
        const term = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
        filter.$or = searchable.map((c) => ({ [c]: term }));
      }

      for (const field of filterable) {
        // A filter is either a field name, or { param, path } when the value is
        // named differently in the query string.
        const param = typeof field === 'object' ? field.param : field;
        const path = typeof field === 'object' ? field.path || field.column : field;
        const value = req.query[param];
        if (value !== undefined && value !== '' && value !== 'ALL') {
          filter[path] = references.has(path) ? oid(value) : value;
        }
      }

      // Optional date-range filter via ?from=&to=&dateField=
      const dateField = req.query.dateField;
      if (dateField && paths.includes(dateField)) {
        const range = {};
        if (req.query.from) range.$gte = String(req.query.from);
        if (req.query.to) range.$lte = `${String(req.query.to)}￿`;
        if (Object.keys(range).length) filter[dateField] = range;
      }

      const requested = String(req.query.sort || defaultSort);
      const column = sortable.includes(requested) ? requested : defaultSort;
      const direction = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
      const field = column === 'id' ? '_id' : column;

      /*
       * A sort with ties has no defined order among them, so the same query can
       * return rows in a different order each time — which means paging a list
       * can show one row twice and skip another. The key breaks every tie, so
       * the order is total and paging is stable.
       */
      const sort = field === '_id' ? { _id: direction } : { [field]: direction, _id: direction };

      const query = Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
      if (Object.keys(populate).length) query.populate(populateFor(populate));

      const [docs, total] = await Promise.all([query.exec(), Model.countDocuments(filter)]);
      const rows = withDerived(await withCounts(Object.keys(populate).length ? lift(docs, populate) : plain(docs)));

      return paginated(res, rows, total, { page, limit });
    })
  );

  // ---------------------------------------------------------- DETAIL
  router.get(
    ID_PARAM,
    requirePermission(perm.view),
    asyncHandler(async (req, res) => {
      const row = await fetchById(req, req.params.id);
      await assertAccess(req, row);
      return ok(res, row);
    })
  );

  if (readOnly) return router;

  // ---------------------------------------------------------- CREATE
  router.post(
    '/',
    requirePermission(perm.create),
    asyncHandler(async (req, res) => {
      let data = pick(req.body, writableColumns);

      const missing = required.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
      if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(', ')}`);

      if (hasCampus) {
        data.campus_id = isAdmin(req.user) && req.body.campus_id ? req.body.campus_id : req.user.campus_id;
      }
      if (paths.includes('created_by')) data.created_by = req.user.id;

      if (beforeCreate) data = (await beforeCreate(data, req)) ?? data;
      await assertPayloadBoard(req, data);

      const doc = await Model.create(coerce(data));
      const row = await fetchById(req, doc._id);

      if (afterCreate) await afterCreate(row, req);
      await logActivity({
        req, action: 'CREATE', module, entityType, entityId: String(doc._id),
        description: `Created ${entityType}`, newValues: data,
      });
      return created(res, row);
    })
  );

  // ----------------------------------------------------------- UPDATE
  router.patch(
    ID_PARAM,
    requirePermission(perm.edit),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const existing = await fetchById(req, id);
      await assertAccess(req, existing);

      let data = pick(req.body, writableColumns);
      if (beforeUpdate) data = (await beforeUpdate(data, req, existing)) ?? data;
      await assertPayloadBoard(req, { ...existing, ...data });

      if (Object.keys(data).length) {
        await Model.updateOne({ _id: oid(id) }, { $set: coerce(data) }, { runValidators: true });
      }
      const row = await fetchById(req, id);

      if (afterUpdate) await afterUpdate(row, req, existing);
      const changes = diff(existing, row);
      await logActivity({
        req, action: 'UPDATE', module, entityType, entityId: String(id),
        description: `Updated ${entityType}`, oldValues: changes.old, newValues: changes.new,
      });
      return ok(res, row);
    })
  );

  // ----------------------------------------------------------- DELETE
  router.delete(
    ID_PARAM,
    requirePermission(perm.delete),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const existing = await fetchById(req, id);
      await assertAccess(req, existing);
      if (beforeDelete) await beforeDelete(existing, req);

      await Model.deleteOne({ _id: oid(id) });
      await logActivity({
        req, action: 'DELETE', module, entityType, entityId: String(id),
        description: `Deleted ${entityType}`, oldValues: existing,
      });
      return ok(res, { id, deleted: true });
    })
  );

  return router;
}

/** Only the fields a caller is allowed to set, and only those they sent. */
export function pick(body, allowed) {
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
