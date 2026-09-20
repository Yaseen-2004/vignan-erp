/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function ok(res, data, meta) {
  return res.json(meta ? { data, meta } : { data });
}

export function created(res, data) {
  return res.status(201).json({ data });
}

/** Parse ?page=&limit= into safe SQL LIMIT/OFFSET values. */
export function pagination(query, defaultLimit = 25, maxLimit = 200) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.min(Math.max(1, requested), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated(res, rows, total, { page, limit }) {
  return res.json({
    data: rows,
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

/** Only allow sorting by a column that actually exists on the resource. */
export function safeSort(query, allowed, fallback = 'id') {
  const column = allowed.includes(query.sort) ? query.sort : fallback;
  const direction = String(query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { column, direction };
}
