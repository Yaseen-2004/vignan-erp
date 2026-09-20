import { useMemo, useState } from 'react';
import { Checkbox, Input } from './ui.jsx';

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
 * Read the stored setting into a complete 1–7 map.
 *
 * Mirrors `server/src/lib/periods.js`: a JSON object keyed by weekday, or a
 * bare number meaning the same every day. A value written before the per-day
 * option still opens correctly, so nothing has to be migrated.
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
      return Object.fromEntries(WEEKDAYS.map((d) => [d.day, clamp(parsed[d.day] ?? parsed[String(d.day)] ?? 0)]));
    } catch {
      return flat(fallback);
    }
  }
  const number = Number(text);
  return flat(Number.isFinite(number) ? number : fallback);
}

export const isUniform = (map) => WEEKDAYS.every((d) => map[d.day] === map[1]);

/** "Mon–Fri 8 · Sat 4 · Sun closed" — the whole week in one line. */
export function summarisePeriods(map) {
  if (isUniform(map)) {
    return map[1] ? `${map[1]} periods every day` : 'No teaching periods set';
  }
  const runs = [];
  for (const { day, short } of WEEKDAYS) {
    const count = map[day];
    const last = runs[runs.length - 1];
    if (last && last.count === count) last.to = short;
    else runs.push({ from: short, to: short, count });
  }
  return runs
    .map((run) => {
      const label = run.from === run.to ? run.from : `${run.from}–${run.to}`;
      return run.count ? `${label} ${run.count}` : `${label} closed`;
    })
    .join(' · ');
}

/**
 * The Periods Per Day control.
 *
 * A school rarely runs the same timetable all week — Saturday is often short
 * and Sunday closed — so this offers one figure for every day, or a figure per
 * day once the Admin asks for it. Switching to per-day starts from whatever the
 * single figure was, so nothing is lost by looking.
 *
 * The value is handed back as a string, ready for the settings API: a plain
 * number while the week is uniform, JSON once it is not.
 */
export function PeriodsPerDay({ value, onChange }) {
  const map = useMemo(() => parsePeriodsPerDay(value), [value]);

  /**
   * Which mode the control is in.
   *
   * This cannot be derived from the value alone: a week of 8s is uniform
   * whether the Admin wants one figure or is midway through setting seven, so
   * asking for per-day has to be remembered. A value that is genuinely uneven
   * always shows per-day regardless.
   */
  const [chosePerDay, setChosePerDay] = useState(false);
  const perDay = chosePerDay || !isUniform(map);

  const emit = (next, asPerDay) =>
    onChange(asPerDay ? JSON.stringify(next) : String(next[1]));

  const setEveryDay = (n) => emit(Object.fromEntries(WEEKDAYS.map((d) => [d.day, clamp(n)])), false);
  const setOneDay = (day, n) => emit({ ...map, [day]: clamp(n) }, true);

  const switchMode = (wantPerDay) => {
    setChosePerDay(wantPerDay);
    // Carry the current figures across, so switching never loses the week.
    emit(map, wantPerDay);
  };

  return (
    <div className="periods">
      <Checkbox
        label="Different for each day"
        checked={perDay}
        onChange={(event) => switchMode(event.target.checked)}
      />

      {perDay ? (
        <div className="periods-grid mt-3">
          {WEEKDAYS.map(({ day, short, name }) => (
            <label key={day} className={`periods-day${map[day] ? '' : ' off'}`} title={name}>
              <span className="d">{short}</span>
              <Input
                type="number"
                min={0}
                max={MAX_PERIODS}
                value={map[day]}
                onChange={(event) => setOneDay(day, event.target.value)}
                aria-label={`Periods on ${name}`}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="row mt-3" style={{ gap: 10 }}>
          <Input
            type="number"
            min={0}
            max={MAX_PERIODS}
            value={map[1]}
            onChange={(event) => setEveryDay(event.target.value)}
            style={{ width: 90 }}
            aria-label="Periods every day"
          />
          <span className="text-sm text-muted">periods, every day of the week</span>
        </div>
      )}

      <p className="field-hint mt-2">
        {summarisePeriods(map)}
        {perDay && ' — 0 means the school is closed that day.'}
      </p>
    </div>
  );
}

export default PeriodsPerDay;
