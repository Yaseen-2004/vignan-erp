/**
 * API client.
 *
 * Holds the access token in memory only (the refresh token lives in an
 * httpOnly cookie), and transparently refreshes an expired session once
 * before surfacing an error.
 */
/**
 * Where the API is.
 *
 * Empty — the default — means "same origin as this page", which is how the
 * portal runs in development and whenever both are served together. Set
 * VITE_API_URL at build time to the API's address when the two are deployed
 * separately, e.g. https://erp-api.example.com
 *
 * Note that a split deployment also needs the API to send its session cookie
 * cross-site (COOKIE_SAMESITE=none) and to name this site in CORS_ORIGINS.
 * Neither is guessable from here, which is why both are settings rather than
 * inference.
 */
const ORIGIN = String(import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '');
const BASE = `${ORIGIN}/api`;

/**
 * The full URL of something the API stored — a pupil's photograph, a document,
 * a course material.
 *
 * The server records these as paths like `/uploads/photos/x.jpg`, which are
 * relative to the API, not to this page. On one origin the distinction does not
 * arise; on two it is the difference between a photograph and a broken image.
 */
export function assetUrl(path) {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;  // already absolute
  return `${ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

let accessToken = null;
let onUnauthorized = null;
let refreshing = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Field -> message, for inline form errors. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((acc, item) => {
      if (item?.field) acc[item.field] = item.message;
      return acc;
    }, {});
  }
}

async function refreshSession() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) throw new Error('refresh failed');
      const payload = await response.json();
      accessToken = payload.data.accessToken;
      return payload.data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request(path, { method = 'GET', body, headers = {}, signal, retry = true, raw = false } = {}) {
  const isFormData = body instanceof FormData;
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: {
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // A cancelled request is the caller's own doing; leave it alone.
    if (cause?.name === 'AbortError') throw cause;
    // Everything else here is the request never arriving: no network, the
    // server not running, or the browser refusing it because the server did
    // not allow this site. The browser deliberately hides which, so the
    // message covers them without pretending to know.
    throw new ApiError(
      `The portal cannot reach the school server at ${ORIGIN || 'this address'}. `
      + 'Check that the server is running and that it allows this site.',
      0,
      'UNREACHABLE'
    );
  }

  // A 401 on an authenticated call means the access token aged out.
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      await refreshSession();
      return request(path, { method, body, headers, signal, retry: false, raw });
    } catch {
      onUnauthorized?.();
      throw new ApiError('Your session has expired. Please sign in again.', 401, 'UNAUTHENTICATED');
    }
  }

  if (raw) {
    if (!response.ok) throw new ApiError('Download failed', response.status, 'DOWNLOAD_ERROR');
    return response;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload?.error;
    if (error?.message) {
      throw new ApiError(error.message, response.status, error.code, error.details);
    }
    // No JSON error body means the response did not come from this API at all.
    throw new ApiError(offApi(response), response.status, 'UNREACHABLE');
  }

  return payload;
}

/**
 * Explain a reply that did not come from the API.
 *
 * Every real failure here arrives as JSON with a message written for the
 * person reading it. Anything else means the request reached something that is
 * not this API — most often a site deployed without one behind it, where a
 * static host answers a sign-in POST with 405 because it serves GET and
 * nothing else. "Request failed (405)" tells nobody anything; this says what
 * actually happened and what to look at.
 */
function offApi(response) {
  const where = ORIGIN || 'the same address as this page';
  switch (response.status) {
    case 404:
    case 405:
    case 501:
      return `The portal cannot reach the school server. It is set to use ${where}, `
        + 'which is answering as a plain web site rather than the ERP server. '
        + 'If this site was just deployed, the server may not be running yet.';
    case 502:
    case 503:
    case 504:
      return 'The school server is not responding. It may be starting up — '
        + 'wait a moment and try again.';
    default:
      return `The school server replied unexpectedly (${response.status}).`;
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  raw: (path, options) => request(path, { ...options, raw: true }),
  refresh: refreshSession,
};

/** Turn a params object into a query string, dropping empty values. */
export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'ALL') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Trigger a browser download for an export endpoint. */
export async function download(path, filename) {
  const response = await api.raw(path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
