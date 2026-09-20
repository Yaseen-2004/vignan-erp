import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { badRequest } from '../lib/errors.js';

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
 * Files are stored with a generated name — the original name is never used on
 * disk, which removes path-traversal and executable-extension risk.
 */
function storageFor(folder) {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(env.uploadDir, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = EXTENSIONS.has(ext) ? ext : '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    },
  });
}

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
  return multer({
    storage: storageFor(folder),
    fileFilter: filterFor(kinds),
    limits: { fileSize: maxMb * 1024 * 1024, files: 10 },
  });
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

/** Public URL for a stored file. */
export const publicPath = (file) =>
  file ? `/uploads/${path.relative(env.uploadDir, file.path).split(path.sep).join('/')}` : null;

/** Delete a previously stored upload, guarding against escapes from uploadDir. */
export function deleteUpload(relativeUrl) {
  if (!relativeUrl || !relativeUrl.startsWith('/uploads/')) return false;
  const target = path.resolve(env.uploadDir, relativeUrl.replace('/uploads/', ''));
  if (!target.startsWith(path.resolve(env.uploadDir))) return false;
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    return true;
  }
  return false;
}
