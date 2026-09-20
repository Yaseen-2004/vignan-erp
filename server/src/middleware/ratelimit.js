import rateLimit from 'express-rate-limit';

const message = (text) => ({ error: { code: 'RATE_LIMITED', message: text } });

/** Brute-force protection for credential endpoints. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: message('Too many sign-in attempts. Please try again in 15 minutes.'),
});

/** General API ceiling. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many requests. Please slow down.'),
});

/** Uploads and report generation cost far more than a normal read. */
export const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many uploads or exports. Please wait a moment.'),
});
