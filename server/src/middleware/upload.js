import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { remove, store } from '../lib/files.js';

const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ],
  media: ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4'],
};

const EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.mp4', '.webm', '.mp3', '.m4a',
]);

/**
 * Uploads are received into memory, not written straight to disk.
 *
 * Where a file finally belongs — the local disk or object storage — is a
 * deployment decision, and multer cannot make it. Holding the bytes for the
 * moment it takes to hand them to `lib/files.js` keeps that decision in one
 * place. The size limits below are what bound the memory this costs.
 */
function filterFor(kinds) {
  const allowed = kinds.flatMap((k) => ALLOWED[k] || []);
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(file.mimetype) || !EXTENSIONS.has(ext)) {
      return cb(badRequest(`File type not permitted: ${file.mimetype || ext || 'unknown'}`));
    }
    cb(null, true);
  };
}

export function uploader(folder, kinds = ['image', 'document'], maxMb = env.maxUploadMb) {
  const middleware = multer({
    storage: multer.memoryStorage(),
    fileFilter: filterFor(kinds),
    limits: { fileSize: maxMb * 1024 * 1024, files: 10 },
  });
  // The folder travels with the uploader so call sites keep saying which kind
  // of thing they are storing, exactly as they did before.
  middleware.folder = folder;
  return middleware;
}

/**
 * A spreadsheet being imported, held in memory rather than written to disk.
 *
 * The file is read once, turned into records and discarded — keeping a copy
 * under uploads/ would leave every pupil's date of birth and address sitting in
 * a web-served directory for no reason.
 *
 * The type check is by extension and declared type both, because a .csv arrives
 * as text/csv from one browser, application/vnd.ms-excel from another, and
 * application/octet-stream from a few.
 */
export const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') return cb(badRequest('Please upload a .csv file'));
    cb(null, true);
  },
});

export const photoUpload = uploader('photos', ['image'], 4);
export const documentUpload = uploader('documents', ['image', 'document']);
export const materialUpload = uploader('materials', ['image', 'document', 'media'], 50);

/**
 * Store an uploaded file and return the path to record against it.
 *
 * Asynchronous now, because storing may mean a request to object storage
 * rather than a write to the disk under our feet.
 */
export const publicPath = (file, folder) => store(file, folder || file?.fieldname || 'misc');

/** Delete a previously stored upload. */
export const deleteUpload = (storedPath) => remove(storedPath);
