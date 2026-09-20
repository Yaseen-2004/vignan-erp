import { z } from 'zod';
import { unprocessable } from '../lib/errors.js';

/**
 * A number that may legitimately be absent.
 *
 * `z.coerce.number().nullable()` does not do this: coercion runs first, and
 * `Number(null)` is 0, so an explicitly empty value arrives as zero. Where the
 * field also allows zero — a mark, a count of years — nothing downstream can
 * tell "not entered" from "entered as nought". For marks that is the difference
 * between a pupil who has not been assessed and one who scored nothing.
 *
 * Emptiness is decided before coercion here, so null stays null.
 */
export const optionalNumber = (min = 0, max) => z.preprocess(
  (value) => (value === null || value === undefined || value === '' ? null : Number(value)),
  (() => {
    let schema = z.number().min(min);
    if (max !== undefined) schema = schema.max(max);
    return schema.nullable().optional();
  })()
);

/** Validate req.body against a zod schema and replace it with the parsed value. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    return next(
      unprocessable(
        'Please correct the highlighted fields',
        result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      )
    );
  }
  req.body = result.data;
  next();
};

/** Validate req.query; the parsed value lands on req.validatedQuery. */
export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    return next(
      unprocessable(
        'Invalid filter parameters',
        result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      )
    );
  }
  req.validatedQuery = result.data;
  next();
};

/** Control characters (including NUL) have no place in submitted text. */
const isControlChar = (code) => code < 32 || code === 127;

function stripControlChars(value) {
  let out = '';
  for (const char of value) {
    if (!isControlChar(char.codePointAt(0))) out += char;
  }
  return out;
}

/**
 * Strip control characters and trim every string in the payload.
 * HTML is not stripped here: values are stored raw and escaped at render time
 * (React escapes by default), so legitimate characters survive intact.
 */
export function sanitizeBody(req, _res, next) {
  const clean = (value) => {
    if (typeof value === 'string') return stripControlChars(value).trim();
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object' && value.constructor === Object) {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = clean(v);
      return out;
    }
    return value;
  };
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  next();
}
