import { Router } from 'express';
import { all, get, insert, update, remove, scalar, tableColumns } from '../db/connection.js';
import { asyncHandler, pagination, paginated, ok, created, safeSort } from './http.js';
import { notFound, forbidden, badRequest } from './errors.js';
import { requirePermission } from '../middleware/auth.js';
import { logActivity, diff } from './audit.js';
import { boardClause, boardOf, isAdmin } from './scope.js';

/**
 * Builds a fully guarded CRUD router for one table.
 *
 * Every generated endpoint performs the five mandated checks:
 *   1. authentication  — applied by the parent router
 *   2. role            — implied by the permission matrix
 *   3. permission      — requirePermission(`${module}.${action}`)
 *   4. ownership       — options.rowFilter / options.canAccess
 *   5. assignment      — options.scopeClause (e.g. only assigned courses)
 *
 * and writes an audit entry with before/after values for every mutation.
 *
 * @param {object} options
 * @param {string} options.table            physical table name
 * @param {string} options.module           permission module (e.g. 'students')
 * @param {string} [options.entityType]     label used in the audit log
 * @param {string} [options.alias]          SQL alias for the base table
 * @param {string} [options.select]         custom column list for list/detail
 * @param {string} [options.joins]          JOIN clauses used with `select`
 * @param {string[]} [options.searchable]   columns matched by ?search=
 * @param {string[]} [options.filterable]   columns matched by exact ?column=
 * @param {string[]} [options.sortable]     columns allowed in ?sort=
 * @param {string[]} [options.writable]     columns a client may write
 * @param {string[]} [options.required]     columns required on create
 * @param {boolean} [options.campusScoped]  restrict rows to the caller's campus
 * @param {string}  [options.defaultSort]
 * @param {function} [options.scopeClause]  (req) => ({ clause, params })
 * @param {function} [options.canAccess]    (req, row) => boolean
 * @param {function} [options.beforeCreate] (data, req) => data
 * @param {function} [options.beforeUpdate] (data, req, existing) => data
 * @param {function} [options.afterCreate]  (row, req) => void
 * @param {function} [options.afterUpdate]  (row, req, before) => void
 * @param {function} [options.beforeDelete] (row, req) => void
 * @param {boolean} [options.readOnly]      expose only list/detail
 */
export function createResourceRouter(options) {
  const {
    table,
    module,
    entityType = table,
    alias = 't',
    select,
    joins = '',
    searchable = [],
    filterable = [],
    /**
     * Qualified column holding this resource's department, e.g. 'c.board'.
     * When set, a user assigned to one department can neither list nor write
     * records belonging to the other — the ?board= filter may narrow further
     * but never widens past this.
     */
    boardColumn = null,
    sortable = ['id'],
    writable,
    required = [],
    campusScoped = true,
    defaultSort = 'id',
    scopeClause,
    canAccess,
    beforeCreate,
    beforeUpdate,
    afterCreate,
    afterUpdate,
    beforeDelete,
    readOnly = false,
    permissions = {},
  } = options;

  const router = Router();
  const columns = tableColumns(table).map((c) => c.name);
  const writableColumns =
    writable ||
    columns.filter((c) => !['id', 'created_at', 'updated_at', 'campus_id', 'created_by'].includes(c));

  const perm = {
    view: permissions.view ?? `${module}.view`,
    create: permissions.create ?? `${module}.create`,
    edit: permissions.edit ?? `${module}.edit`,
    delete: permissions.delete ?? `${module}.delete`,
  };

  const hasCampus = columns.includes('campus_id');
  const baseSelect = select || `${alias}.*`;
  const from = `FROM ${table} ${alias} ${joins}`;

  /** WHERE fragments shared by list and detail. */
  async function buildScope(req) {
    const clauses = [];
    const params = [];

    if (campusScoped && hasCampus) {
      // Admin may inspect any campus; everyone else is pinned to their own.
      if (isAdmin(req.user)) {
        if (req.query.campus_id) {
          clauses.push(`${alias}.campus_id = ?`);
          params.push(Number(req.query.campus_id));
        }
      } else if (req.user.campus_id) {
        clauses.push(`${alias}.campus_id = ?`);
        params.push(req.user.campus_id);
      }
    }

    // The department a user is confined to is a ceiling, not a preference.
    if (boardColumn) {
      const confine = await boardClause(req.user, boardColumn);
      if (confine) {
        clauses.push(confine.clause);
        params.push(...confine.params);
      }
    }

    if (scopeClause) {
      const extra = await scopeClause(req);
      if (extra?.clause) {
        clauses.push(extra.clause);
        params.push(...(extra.params || []));
      }
    }
    return { clauses, params };
  }

  /**
   * Fetch one row, already confined to the caller's department.
   *
   * Filtering the list is not enough: without this, a deep link to a record in
   * the other wing would still resolve. Applying the clause in the WHERE means
   * such a record simply does not exist for that user, and `assertAccess`
   * turns that into the same "not found" any bad id gets.
   */
  async function fetchById(req, id) {
    const clauses = [`${alias}.id = ?`];
    const params = [Number(id)];
    if (boardColumn) {
      const confine = await boardClause(req.user, boardColumn);
      if (confine) {
        clauses.push(confine.clause);
        params.push(...confine.params);
      }
    }
    return await get(`SELECT ${baseSelect} ${from} WHERE ${clauses.join(' AND ')}`, params);
  }

  /**
   * Refuse a write that would place a record in the other department.
   *
   * Reading is confined by the WHERE clause, but a create carries its own
   * department: either directly (a class has `board`) or through its parent (a
   * section belongs to a class, a course assignment to a section). Resolving it
   * from whichever key the payload carries covers both shapes without each
   * resource having to describe itself.
   */
  async function assertPayloadBoard(req, data) {
    if (!boardColumn) return;
    const wing = await boardOf(req.user);
    if (!wing) return;

    let board = data.board;
    if (!board && data.class_id) {
      board = (await get('SELECT board FROM classes WHERE id = ?', [data.class_id]))?.board;
    }
    if (!board && data.section_id) {
      board = (await get('SELECT c.board FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = ?', [
        data.section_id,
      ]))?.board;
    }
    if (!board && data.course_id) {
      board = (await get('SELECT c.board FROM courses co JOIN classes c ON c.id = co.class_id WHERE co.id = ?', [
        data.course_id,
      ]))?.board;
    }
    if (board && board !== wing) {
      throw forbidden(
        `You are assigned to the ${wing === 'CBSE' ? 'CBSE' : 'State Board'} department and cannot create or change records in the other one.`
      );
    }
  }

  async function assertAccess(req, row) {
    if (!row) throw notFound(`${entityType} not found`);
    if (
      campusScoped &&
      hasCampus &&
      !isAdmin(req.user) &&
      req.user.campus_id &&
      row.campus_id &&
      row.campus_id !== req.user.campus_id
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
      const { page, limit, offset } = pagination(req.query);
      const { column, direction } = safeSort(req.query, sortable, defaultSort);
      const { clauses, params } = await buildScope(req);

      if (req.query.search && searchable.length) {
        const term = `%${String(req.query.search).trim()}%`;
        clauses.push(`(${searchable.map((c) => `${c} ILIKE ?`).join(' OR ')})`);
        params.push(...searchable.map(() => term));
      }

      for (const field of filterable) {
        // A filter is either a column name, or { param, column } when the value
        // lives on a joined table (e.g. filtering courses by their class board).
        const param = typeof field === 'object' ? field.param : field;
        const column = typeof field === 'object' ? field.column : field;
        const value = req.query[param];
        if (value !== undefined && value !== '' && value !== 'ALL') {
          const qualified = column.includes('.') ? column : `${alias}.${column}`;
          clauses.push(`${qualified} = ?`);
          params.push(value);
        }
      }

      // Optional date-range filter on any date-ish column via ?from=&to=&dateField=
      const dateField = req.query.dateField;
      if (dateField && columns.includes(dateField)) {
        if (req.query.from) {
          clauses.push(`substr(${alias}.${dateField}, 1, 10) >= ?`);
          params.push(req.query.from);
        }
        if (req.query.to) {
          clauses.push(`substr(${alias}.${dateField}, 1, 10) <= ?`);
          params.push(req.query.to);
        }
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const sortColumn = column.includes('.') ? column : `${alias}.${column}`;
      // A sort with ties has no defined order among them, so the same query can
      // return rows in a different order each time — which means paging a list
      // can show one row twice and skip another. `numeric_level` alone ties
      // across the two departments, for instance. The primary key breaks every
      // tie, so the order is total and paging is stable.
      const orderBy = sortColumn === `${alias}.id`
        ? `${sortColumn} ${direction}`
        : `${sortColumn} ${direction}, ${alias}.id ${direction}`;
      const total = Number(await scalar(`SELECT COUNT(*) AS n ${from} ${where}`, params) || 0);
      const rows = await all(
        `SELECT ${baseSelect} ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return paginated(res, rows, total, { page, limit });
    })
  );

  // ---------------------------------------------------------- DETAIL
  // `:id` is digits-only so literal sub-routes (e.g. /grid, /pending) that a
  // module registers alongside this factory are not shadowed by the detail route.
  router.get(
    '/:id([0-9]+)',
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
        data.campus_id = isAdmin(req.user) && req.body.campus_id ? Number(req.body.campus_id) : req.user.campus_id;
      }
      if (columns.includes('created_by')) data.created_by = req.user.id;

      if (beforeCreate) data = (await beforeCreate(data, req)) ?? data;
      await assertPayloadBoard(req, data);

      const id = await insert(table, data);
      const row = await fetchById(req, id);

      await logActivity({
        req,
        action: 'CREATE',
        module,
        entityType,
        entityId: id,
        description: `Created ${entityType} #${id}`,
        newValues: data,
      });

      if (afterCreate) await afterCreate(row, req);
      return created(res, row);
    })
  );

  // ---------------------------------------------------------- UPDATE
  router.put(
    '/:id([0-9]+)',
    requirePermission(perm.edit),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      // Read it through the confined fetch first: a record in the other wing
      // must not exist for this user, whether they are reading or writing it.
      if (!await fetchById(req, id)) throw notFound(`${entityType} not found`);
      const existing = await get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      await assertAccess(req, existing);

      let data = pick(req.body, writableColumns);
      if (beforeUpdate) data = (await beforeUpdate(data, req, existing)) ?? data;
      if (!Object.keys(data).length) throw badRequest('No updatable fields supplied');
      await assertPayloadBoard(req, data);

      await update(table, id, data);
      const row = await fetchById(req, id);
      const changes = diff(existing, { ...existing, ...data });

      await logActivity({
        req,
        action: 'UPDATE',
        module,
        entityType,
        entityId: id,
        description: `Updated ${entityType} #${id}`,
        oldValues: changes.old,
        newValues: changes.new,
      });

      if (afterUpdate) await afterUpdate(row, req, existing);
      return ok(res, row);
    })
  );

  // ---------------------------------------------------------- DELETE
  router.delete(
    '/:id([0-9]+)',
    requirePermission(perm.delete),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!await fetchById(req, id)) throw notFound(`${entityType} not found`);
      const existing = await get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      await assertAccess(req, existing);
      if (beforeDelete) await beforeDelete(existing, req);

      await remove(table, id);
      await logActivity({
        req,
        action: 'DELETE',
        module,
        entityType,
        entityId: id,
        description: `Deleted ${entityType} #${id}`,
        oldValues: existing,
      });
      return ok(res, { id, deleted: true });
    })
  );

  return router;
}

/** Copy only the allowed keys from a request body. */
export function pick(body, allowed) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
