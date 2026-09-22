/**
 * Unique identifiers for people and records.
 *
 * Every record already has a database id — a sequence hands those out and they
 * are never reused. What this file is for is the *other* identifiers, the ones
 * the school reads aloud and writes on forms: the admission number, the faculty
 * code, the username a parent signs in with. Those are unique columns too, and
 * they have to be generated rather than typed.
 *
 * Two ways of doing that were already in the codebase and both are unsafe:
 *
 *   COUNT(*) + 1        repeats a code as soon as any record is deleted —
 *                       twenty-three faculty minus one leaves 22, and the next
 *                       code is VFT0023, which already exists.
 *   Date.now()          two records created in the same millisecond collide,
 *                       and the truncated form used for parent codes repeats
 *                       roughly every 27 hours.
 *
 * Neither survives a bulk import, where hundreds of records are created in one
 * pass. An allocator instead reads the highest number actually in use once,
 * then counts on from there in memory — so a CSV of five hundred pupils costs
 * one query rather than five hundred, and cannot repeat a number within the
 * batch or against what is already stored.
 *
 * The unique constraint in the schema remains the real guarantee. This is what
 * keeps the constraint from being hit in the first place.
 */
import { byCollection, User } from '../db/mongo/models.js';
import { startsWith } from '../db/mongo/query.js';

/**
 * An allocator for codes shaped `<prefix><zero-padded number>`.
 *
 * @param {object}  spec
 * @param {string}  spec.table    table holding the column
 * @param {string}  spec.column   the unique column
 * @param {string}  spec.prefix   e.g. 'VGN2026-'
 * @param {number}  spec.width    digits to pad to
 * @param {string}  [spec.scopeColumn]  restrict to one campus, wing, etc.
 * @param {*}       [spec.scopeValue]
 */
export async function sequenceAllocator({ table, column, prefix, width, scopeColumn, scopeValue }) {
  const Model = byCollection[table];
  if (!Model) throw new Error(`No collection named ${table}`);

  // `LIKE 'prefix%'` becomes an anchored pattern, escaped: a prefix is text,
  // not a pattern, and one containing a dot would quietly match more than it
  // should.
  const filter = { [column]: startsWith(prefix) };
  if (scopeColumn) filter[scopeColumn] = scopeValue;

  // The numbers are read back and compared here rather than in the query: the
  // suffix is text, and a code someone typed by hand may not be a number at
  // all. Comparing as text would make 'VGN9' higher than 'VGN10'.
  const rows = (await Model.find(filter).select(column).lean())
    .map((r) => ({ code: r[column] }));
  let highest = 0;
  for (const row of rows) {
    const suffix = String(row.code).slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    highest = Math.max(highest, Number(suffix));
  }

  const issued = new Set(rows.map((r) => String(r.code)));
  let next = highest;

  return {
    /** The next unused code. */
    take() {
      let code;
      do {
        next += 1;
        code = prefix + String(next).padStart(width, '0');
      } while (issued.has(code)); // a hand-typed code could sit above the run
      issued.add(code);
      return code;
    },
    /** Claim a code supplied in the file, refusing one already in use. */
    claim(code) {
      if (issued.has(code)) return null;
      issued.add(code);
      return code;
    },
    get issuedCount() { return issued.size; },
  };
}

/**
 * An allocator for usernames, which are words rather than numbers.
 *
 * A name is turned into a handle, and a handle already taken gains a number:
 * `rkulkarni`, then `rkulkarni2`. Names repeat in a school of this size —
 * several Kulkarnis in one class is ordinary — so this has to be expected
 * rather than exceptional.
 */
export async function usernameAllocator() {
  const rows = await User.find({}).select('username').lean();
  const taken = new Set(rows.map((r) => String(r.username).toLowerCase()));

  return {
    /** A free username based on `seed`, falling back to `fallback`. */
    take(seed, fallback = 'user') {
      const base = String(seed || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 24) || fallback;
      if (!taken.has(base)) { taken.add(base); return base; }
      for (let n = 2; ; n += 1) {
        const candidate = `${base}${n}`;
        if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
      }
    },
    /** Claim a username supplied in the file, refusing one already in use. */
    claim(username) {
      const key = String(username).toLowerCase();
      if (taken.has(key)) return null;
      taken.add(key);
      return key;
    },
  };
}

/* ------------------------------------------------------------- the shapes */
/** Admission numbers restart each calendar year: VGN2026-0001. */
export const admissionNumbers = (campusId) => sequenceAllocator({
  table: 'students',
  column: 'admission_number',
  prefix: `VGN${new Date().getFullYear()}-`,
  width: 4,
  scopeColumn: 'campus_id',
  scopeValue: campusId,
});

/** Teaching staff are VFT0001, non-teaching VFF0001. */
export const facultyCodes = (campusId, staffType) => sequenceAllocator({
  table: 'faculty',
  column: 'faculty_code',
  prefix: staffType === 'TEACHING' ? 'VFT' : 'VFF',
  width: 4,
  scopeColumn: 'campus_id',
  scopeValue: campusId,
});

export const employeeCodes = (campusId) => sequenceAllocator({
  table: 'administrators',
  column: 'employee_code',
  prefix: 'VADM',
  width: 3,
  scopeColumn: 'campus_id',
  scopeValue: campusId,
});

/**
 * Fee receipts: RCP/2026/00001, numbered per campus per year.
 *
 * This one is not cosmetic. `receipt_number` is unique, so a repeated number is
 * a refused insert — a parent at the counter whose payment will not save. The
 * old count-based number repeated as soon as any receipt was removed, which the
 * storage purge does on a schedule.
 */
export const receiptNumbers = (campusId, year = new Date().getFullYear()) => sequenceAllocator({
  table: 'fee_receipts',
  column: 'receipt_number',
  prefix: `RCP/${year}/`,
  width: 5,
  scopeColumn: 'campus_id',
  scopeValue: campusId,
});

/** Payslips: PS/2026/09/00001, numbered within the month they cover. */
export const payslipNumbers = (year, month) => sequenceAllocator({
  table: 'payroll',
  column: 'payslip_number',
  prefix: `PS/${year}/${String(month).padStart(2, '0')}/`,
  width: 5,
});

export const parentCodes = (campusId) => sequenceAllocator({
  table: 'parents',
  column: 'parent_code',
  prefix: 'PRN',
  width: 5,
  scopeColumn: 'campus_id',
  scopeValue: campusId,
});
