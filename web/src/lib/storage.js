/**
 * Remembered preferences, safely.
 *
 * `localStorage` is not always there and not always allowed: it is absent when
 * a page is rendered on the server, and accessing it throws outright in a
 * browser configured to block site data. A remembered preference is never worth
 * a blank page, so every read falls back and every write is best-effort.
 *
 * Use this rather than touching `localStorage` directly — particularly inside a
 * `useState` initialiser, which runs during render.
 */
const available = () => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return false;
  }
};

/** The stored value for `key`, or `fallback` when there is none to be had. */
export function readSetting(key, fallback = null) {
  if (!available()) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** Store a preference. Silently does nothing where storage is unavailable. */
export function writeSetting(key, value) {
  if (!available()) return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* quota exceeded, or site data blocked — the preference is not worth an error */
  }
}

/** Read a preference constrained to a known set, falling back when it is not. */
export function readChoice(key, allowed, fallback) {
  const value = readSetting(key, fallback);
  return allowed.includes(value) ? value : fallback;
}
