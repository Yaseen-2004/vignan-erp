import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export // Vercel, AWS Lambda and the like set one of these; a plain server sets neither.
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const SERVER_ROOT = path.resolve(__dirname, '..', '..');

function required(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Missing required environment variable ${name}. Set it in server/.env before starting in production.`
    );
  }
  // Development convenience only — production refuses to boot without real secrets.
  return fallback;
}

const devSecret = () => crypto.createHash('sha256').update('vignan-erp-dev-only').digest('hex');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 4000),
  appName: process.env.APP_NAME || 'Vignan Educational Institutions ERP',

  // The school's data lives in a managed cloud PostgreSQL. Set DATABASE_URL to
  // its connection string and everything — records, uploads metadata, audit
  // trail — is stored there. With it unset the server falls back to a local
  // PostgreSQL (PGlite) under data/, which needs nothing installed and is what
  // development and the test suites run against.
  databaseUrl: process.env.DATABASE_URL || '',
  databaseDir: process.env.DATABASE_DIR || path.join(SERVER_ROOT, 'data', 'pg'),
  // One instance of a serverless function serves one request at a time, but
  // there may be a great many instances. Ten connections each is how a managed
  // database runs out of them; the pooled connection string a provider offers
  // is what handles the fan-in.
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || (IS_SERVERLESS ? 1 : 10)),

  // Retained so the one-off importer can find a pre-migration SQLite file.
  databaseFile: process.env.DATABASE_FILE || path.join(SERVER_ROOT, 'data', 'vignan_erp.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(SERVER_ROOT, 'uploads'),

  // Uploaded files — photographs, documents, course materials. Set these and
  // they are kept in object storage, which survives a redeploy; leave them and
  // they go to uploadDir above, which on most hosts does not. Any S3-compatible
  // service works: Cloudflare R2, Amazon S3, Backblaze B2, MinIO.
  s3Bucket: process.env.S3_BUCKET || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'auto',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),

  // Device notifications. The keys are this server's own identity to the push
  // services — self-generated, no account anywhere. Without them push is simply
  // switched off and the in-app bell carries on as before.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:office@vignan.edu',

  // 'lax' while the portal and API share an origin; 'none' when they do not,
  // which also requires https. See the refresh cookie in routes/auth.js.
  cookieSameSite: ['lax', 'none', 'strict'].includes(process.env.COOKIE_SAMESITE)
    ? process.env.COOKIE_SAMESITE
    : 'lax',

  jwtSecret: required('JWT_SECRET', devSecret()),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', devSecret() + 'r'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '30m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 15),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  seedPassword: process.env.SEED_PASSWORD || 'Vignan@123',
};

export default env;
