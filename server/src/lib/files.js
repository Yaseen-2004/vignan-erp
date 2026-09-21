/**
 * Where uploaded files live.
 *
 * Photographs, documents and course materials were written to a folder beside
 * the server. That works on one machine and fails on a hosted one: most
 * platforms give a container a fresh filesystem on every deploy, so a redeploy
 * silently takes every photograph and every uploaded document with it. Records
 * are safe — they are in PostgreSQL — but the files they point at are gone, and
 * nobody notices until a parent opens a blank document.
 *
 * So there are two places a file can live, chosen by configuration rather than
 * by code:
 *
 *   object storage   when S3_BUCKET is set. Any S3-compatible service —
 *                    Cloudflare R2, Amazon S3, Backblaze B2, MinIO. Files
 *                    outlive the server that wrote them.
 *   the local disk   otherwise. Unchanged behaviour, which is what development
 *                    and the test suites want: no credentials, no network.
 *
 * Both answer the same three questions — store this, read that, forget it — and
 * both address a file by the same key, so a stored path means the same thing
 * whichever is in use and nothing downstream has to know which.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import env from '../config/env.js';

/** File types that may be stored, by extension. */
const EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.mp4', '.webm', '.mp3', '.m4a',
]);

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
};

export const usingObjectStorage = Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey);

const client = usingObjectStorage
  ? new AwsClient({
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
    // R2 ignores the region but the signature still has to name one.
    region: env.s3Region || 'auto',
    service: 's3',
  })
  : null;

const objectUrl = (key) => `${env.s3Endpoint.replace(/\/+$/, '')}/${env.s3Bucket}/${key}`;

/**
 * A name for a stored file.
 *
 * The name the person uploaded is never used: it decides nothing here, and
 * letting it through invites both path traversal and an executable extension
 * arriving under a trusted name. Only the extension survives, and only when it
 * is one we serve.
 */
function keyFor(folder, originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const safe = EXTENSIONS.has(ext) ? ext : '.bin';
  return `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safe}`;
}

export const contentTypeFor = (key) => CONTENT_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';

/** A key is ours only if it is a plain relative path under a known folder. */
const FOLDERS = new Set(['photos', 'documents', 'materials', 'students', 'faculty', 'misc']);
export function isSafeKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.includes('\\') || key.startsWith('/')) return false;
  const [folder, ...rest] = key.split('/');
  return FOLDERS.has(folder) && rest.length === 1 && rest[0].length > 0;
}

/* ===================================================================== */
/*  STORING                                                              */
/* ===================================================================== */

/**
 * Store an uploaded file and return the path to record against the record it
 * belongs to. The path is the same shape either way — `/uploads/photos/x.jpg`.
 */
export async function store(file, folder) {
  if (!file?.buffer) return null;
  const key = keyFor(folder, file.originalname);
  const type = file.mimetype || contentTypeFor(key);

  if (usingObjectStorage) {
    const response = await client.fetch(objectUrl(key), {
      method: 'PUT',
      body: file.buffer,
      headers: { 'Content-Type': type, 'Content-Length': String(file.buffer.length) },
    });
    if (!response.ok) {
      throw new Error(`Could not store the file (${response.status} from object storage)`);
    }
  } else {
    const target = path.join(env.uploadDir, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.buffer);
  }

  return `/uploads/${key}`;
}

/* ===================================================================== */
/*  READING                                                              */
/* ===================================================================== */

/**
 * Fetch a stored file for serving.
 *
 * Returns `{ body, contentType, size }` where `body` is something Express can
 * send — a Buffer from disk, or a web stream from object storage — or null when
 * there is nothing there.
 */
export async function read(key) {
  if (!isSafeKey(key)) return null;

  if (usingObjectStorage) {
    const response = await client.fetch(objectUrl(key), { method: 'GET' });
    if (!response.ok) return null;
    return {
      body: response.body,
      contentType: response.headers.get('content-type') || contentTypeFor(key),
      size: Number(response.headers.get('content-length')) || undefined,
    };
  }

  const target = path.join(env.uploadDir, key);
  if (!fs.existsSync(target)) return null;
  return {
    body: fs.readFileSync(target),
    contentType: contentTypeFor(key),
    size: fs.statSync(target).size,
  };
}

/* ===================================================================== */
/*  FORGETTING                                                           */
/* ===================================================================== */

/** Delete a stored file, given the path recorded against it. */
export async function remove(storedPath) {
  const key = keyFromPath(storedPath);
  if (!key) return false;

  if (usingObjectStorage) {
    const response = await client.fetch(objectUrl(key), { method: 'DELETE' });
    // A file already gone is a success as far as the caller is concerned.
    return response.ok || response.status === 404;
  }

  const target = path.join(env.uploadDir, key);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target);
  return true;
}

/** `/uploads/photos/x.jpg` -> `photos/x.jpg`, or null if it is not one of ours. */
export function keyFromPath(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  if (!storedPath.startsWith('/uploads/')) return null;
  const key = storedPath.slice('/uploads/'.length);
  return isSafeKey(key) ? key : null;
}

/** Which store is in use, for the startup banner and the health check. */
export const describe = () =>
  usingObjectStorage
    ? `object storage (${env.s3Bucket})`
    : `local disk (${env.uploadDir})`;
