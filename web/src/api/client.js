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
  const response = await fetch(`${BASE}${path}`, {
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
    throw new ApiError(
      error?.message || `Request failed (${response.status})`,
      response.status,
      error?.code,
      error?.details
    );
  }

  return payload;
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
