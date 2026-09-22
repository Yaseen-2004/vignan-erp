/**
 * Reading, in the shape the rest of the application expects.
 *
 * A SQL join returns one flat row: `u.*` beside `r.code AS role_code`. Populate
 * returns a nested document instead, and the difference is not cosmetic —
 * everything downstream, the portal included, reads `role_code`, not
 * `role_id.code`. Rewriting all of that would be a second port on top of this
 * one, and every line of it a chance to change behaviour by accident.
 *
 * So a populated document is flattened back to the shape the join produced.
 * The join is gone; what it returned is not.
 */
import mongoose from 'mongoose';
import { oid } from './connection.js';

/**
 * A document as the API presents it: plain, with `id` a string.
 *
 * `lean()` results skip the schema's toJSON, so the same mapping is applied
 * here — otherwise a list read with lean() would carry `_id` while a single
 * record carried `id`, and the difference would surface as a blank screen.
 */
export function plain(doc) {
  if (doc == null) return doc;
  if (Array.isArray(doc)) return doc.map((d) => plain(d));
  const source = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === '_id') { out.id = String(v); continue; }
    if (k === '__v') continue;
    out[k] = v instanceof mongoose.Types.ObjectId ? String(v) : v;
  }
  if (out.id === undefined && source._id !== undefined) out.id = String(source._id);
  return out;
}

/**
 * Lift fields out of populated references and onto the record itself.
 *
 *   lift(user, { role_id: { code: 'role_code', name: 'role_name' } })
 *
 * turns a populated `role_id` into `role_code` and `role_name` beside it,
 * exactly as `JOIN roles r ... r.code AS role_code` did. The reference itself
 * is left as an id, because that is what it was before.
 */
export function lift(doc, mapping) {
  if (doc == null) return doc;
  if (Array.isArray(doc)) return doc.map((d) => lift(d, mapping));

  const out = plain(doc);
  for (const [field, fields] of Object.entries(mapping)) {
    const related = doc[field] && typeof doc[field] === 'object' && !(doc[field] instanceof mongoose.Types.ObjectId)
      ? doc[field]
      : null;
    for (const [from, to] of Object.entries(fields)) {
      out[to] = related ? (related[from] ?? null) : null;
    }
    // The reference goes back to being an id, as the flat row had it.
    out[field] = related?._id ? String(related._id) : (doc[field] ? String(doc[field]) : null);
  }
  return out;
}

/** The populate specification implied by a mapping, so the two cannot drift. */
export const populateFor = (mapping) =>
  Object.entries(mapping).map(([path, fields]) => ({
    path,
    select: Object.keys(fields).join(' ') + ' _id',
  }));

/**
 * A page of records, with the total, matching what `paginated()` sent before.
 *
 * The count is a second query. It is worth it: a portal that cannot say how
 * many pupils there are cannot show a page count, and a school with two
 * thousand pupils notices the difference immediately.
 */
export async function page(Model, filter = {}, { page: pageNo = 1, limit = 25, sort = { created_at: -1 }, mapping, select } = {}) {
  const query = Model.find(filter).sort(sort).skip((pageNo - 1) * limit).limit(limit);
  if (select) query.select(select);
  if (mapping) query.populate(populateFor(mapping));

  const [rows, total] = await Promise.all([
    query.exec(),
    Model.countDocuments(filter),
  ]);

  return {
    rows: mapping ? lift(rows, mapping) : plain(rows),
    total,
    meta: { page: pageNo, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** One record by id, or null when the id is not even an identifier. */
export async function byId(Model, id, { mapping, select } = {}) {
  const _id = oid(id);
  if (!_id) return null;
  const query = Model.findById(_id);
  if (select) query.select(select);
  if (mapping) query.populate(populateFor(mapping));
  const doc = await query.exec();
  if (!doc) return null;
  return mapping ? lift(doc, mapping) : plain(doc);
}

/** A case-insensitive exact match, for the columns SQL compared with lower(). */
export const insensitive = (value) => {
  // Escaped, because a username is not a pattern: someone called `a.b` must
  // not match `axb`, and a stray `(` must not make the query throw.
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
};
