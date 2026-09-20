import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * Dropdown data for every form in the app, fetched once per session and
 * shared. `refresh()` re-reads it after a change that adds new options.
 */
let cache = null;
let inFlight = null;
const subscribers = new Set();

async function load() {
  inFlight ??= api
    .get('/academics/lookups')
    .then((result) => {
      cache = result.data;
      subscribers.forEach((fn) => fn(cache));
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useLookups() {
  const [lookups, setLookups] = useState(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    subscribers.add(setLookups);
    if (!cache) {
      load()
        .catch(() => setLookups({}))
        .finally(() => setLoading(false));
    }
    return () => subscribers.delete(setLookups);
  }, []);

  return { lookups: lookups || {}, loading, refresh: () => { cache = null; return load(); } };
}

export function clearLookups() {
  cache = null;
}
