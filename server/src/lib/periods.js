/**
 * How many teaching periods each day of the week carries.
 *
 * Most schools do not run the same timetable seven days a week — Vignan
 * teaches six, with a shorter Saturday — so the `periods_per_day` setting
 * holds a map of weekday to period count rather than a single number.
 *
 * A plain number is still understood and means "the same every day", so a
 * database written before the per-day option, or an Admin who genuinely wants
 * one figure, both keep working without a migration.
 */
import { SystemSetting } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';

/** ISO weekday numbers, matching `timetables.day_of_week` (1 = Monday). */
export const WEEKDAYS = [
  { day: 1, name: 'Monday', short: 'Mon' },
  { day: 2, name: 'Tuesday', short: 'Tue' },
  { day: 3, name: 'Wednesday', short: 'Wed' },
  { day: 4, name: 'Thursday', short: 'Thu' },
  { day: 5, name: 'Friday', short: 'Fri' },
  { day: 6, name: 'Saturday', short: 'Sat' },
  { day: 7, name: 'Sunday', short: 'Sun' },
];

const MAX_PERIODS = 12;
const clamp = (n) => Math.max(0, Math.min(MAX_PERIODS, Math.round(Number(n) || 0)));

/**
 * Normalise whatever is stored into a complete 1–7 map.
 *
 * Accepts a JSON object keyed by weekday, or a bare number meaning every day.
 * Anything unparseable falls back to the supplied default rather than throwing:
 * a malformed setting should not take the timetable down.
 */
export function parsePeriodsPerDay(value, fallback = 8) {
  const flat = (n) => Object.fromEntries(WEEKDAYS.map((d) => [d.day, clamp(n)]));

  if (value === null || value === undefined || value === '') return flat(fallback);

  if (typeof value === 'object') {
    return Object.fromEntries(WEEKDAYS.map((d) => [d.day, clamp(value[d.day] ?? value[String(d.day)] ?? fallback)]));
  }

  const text = String(value).trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return Object.fromEntries(
        WEEKDAYS.map((d) => [d.day, clamp(parsed[d.day] ?? parsed[String(d.day)] ?? 0)])
      );
    } catch {
      return flat(fallback);
    }
  }

  const number = Number(text);
  return flat(Number.isFinite(number) ? number : fallback);
}

/** True when every day carries the same count — the "same every day" case. */
export function isUniform(map) {
  const values = WEEKDAYS.map((d) => map[d.day]);
  return values.every((n) => n === values[0]);
}

/** The configured map for a campus, ready to hand to the client. */
export async function periodsPerDay(campusId) {
  /*
   * A campus setting wins over the school-wide default, which is what
   * `ORDER BY campus_id DESC` achieved: a row naming this campus sorted above
   * the one with no campus at all. Asked directly here, because sorting on a
   * reference to express a preference reads as an accident.
   */
  const id = oid(campusId);
  const row = (id && await SystemSetting.findOne({ key: 'periods_per_day', campus_id: id }).lean())
    || await SystemSetting.findOne({ key: 'periods_per_day', campus_id: null }).lean();
  return parsePeriodsPerDay(row?.value);
}

/** How many periods a given weekday runs; 0 means the school is closed. */
export async function periodsOnDay(campusId, day) {
  return (await periodsPerDay(campusId))[Number(day)] ?? 0;
}
