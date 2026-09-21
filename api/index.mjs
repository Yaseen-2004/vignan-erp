/**
 * The API, as a serverless function.
 *
 * The same Express application the server runs; here it is handed one request
 * at a time instead of owning a port. Everything it does — the routes, the
 * permissions, the audit trail — is unchanged, so there is no second copy of
 * the rules to keep in step.
 *
 * Two things this deployment needs that a long-running server does not:
 *
 *   DATABASE_URL   there is no disk to keep a local database on. Without it
 *                  the app would try to open one and fail on a read-only
 *                  filesystem, so config/env.js refuses with a clear message.
 *   S3_BUCKET      uploaded files likewise have nowhere to live. Without it
 *                  they would be written to a filesystem that is discarded
 *                  when the function finishes.
 *
 * Both are explained in .env.example.
 */
export { default } from '../server/src/index.js';
