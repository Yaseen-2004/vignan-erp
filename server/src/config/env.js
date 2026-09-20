import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');

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
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 10),

  // Retained so the one-off importer can find a pre-migration SQLite file.
  databaseFile: process.env.DATABASE_FILE || path.join(SERVER_ROOT, 'data', 'vignan_erp.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(SERVER_ROOT, 'uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),

  // Device notifications. The keys are this server's own identity to the push
  // services — self-generated, no account anywhere. Without them push is simply
  // switched off and the in-app bell carries on as before.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:office@vignan.edu',

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
