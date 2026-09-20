import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';

import env from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { sanitizeBody } from './middleware/validate.js';
import { apiLimiter, loginLimiter } from './middleware/ratelimit.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import roleRoutes from './routes/roles.js';
import administratorRoutes from './routes/administrators.js';
import facultyRoutes from './routes/faculty.js';
import studentRoutes from './routes/students.js';
import parentRoutes from './routes/parents.js';
import academicsRoutes from './routes/academics.js';
import attendanceRoutes from './routes/attendance.js';
import examRoutes from './routes/exams.js';
import financeRoutes from './routes/finance.js';
import transportRoutes from './routes/transport.js';
import libraryRoutes from './routes/library.js';
import inventoryRoutes from './routes/inventory.js';
import communicationRoutes from './routes/communication.js';
import materialRoutes from './routes/materials.js';
import mentoringRoutes from './routes/mentoring.js';
import dashboardRoutes from './routes/dashboards.js';
import reportRoutes from './routes/reports.js';
import systemRoutes from './routes/system.js';
import importRoutes from './routes/imports.js';
import passwordResetRoutes from './routes/passwordResets.js';
import assignmentRoutes from './routes/assignments.js';
import storageRoutes from './routes/storage.js';
import { describe } from './db/connection.js';

const app = express();

// Behind a proxy in production, so rate limiting and req.ip see the real client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // Uploaded files are served from this origin and embedded by the SPA.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: env.isProd ? undefined : false,
  })
);
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin / curl requests have no Origin header.
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(sanitizeBody);

// ------------------------------------------------------------ public API
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', app: env.appName, time: new Date().toISOString() })
);
app.use('/api/auth', authRoutes);

// Uploaded files. Documents are private in spirit, but are served with
// unguessable generated names and no directory listing.
app.use(
  '/uploads',
  express.static(env.uploadDir, {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

// ------------------------------------------------- authenticated API
const api = express.Router();
api.use(authenticate);
api.use(apiLimiter);

api.use('/dashboards', dashboardRoutes);
api.use('/users', userRoutes);
api.use('/roles', roleRoutes);
api.use('/password-resets', passwordResetRoutes);
api.use('/assignments', assignmentRoutes);
api.use('/storage', storageRoutes);
api.use('/administrators', administratorRoutes);
api.use('/faculty', facultyRoutes);
api.use('/students', studentRoutes);
api.use('/parents', parentRoutes);
api.use('/academics', academicsRoutes);
api.use('/attendance', attendanceRoutes);
api.use('/exams', examRoutes);
api.use('/finance', financeRoutes);
api.use('/transport', transportRoutes);
api.use('/library', libraryRoutes);
api.use('/inventory', inventoryRoutes);
api.use('/communication', communicationRoutes);
api.use('/materials', materialRoutes);
api.use('/mentoring', mentoringRoutes);
api.use('/reports', reportRoutes);
api.use('/system', systemRoutes);
api.use('/imports', importRoutes);

app.use('/api', api);

// ------------------------------------------------------ built SPA (prod)
const clientDist = path.resolve(env.uploadDir, '..', '..', 'web', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`\n  ${env.appName}`);
  console.log(`  API      http://localhost:${env.port}/api`);
  console.log(`  Health   http://localhost:${env.port}/api/health`);
  console.log(`  Database ${describe()}`);
  console.log(`  Mode     ${env.nodeEnv}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
  });
}

export default app;
