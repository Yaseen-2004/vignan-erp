import { AppError } from '../lib/errors.js';
import env from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

/** How long to keep draining a rejected upload before giving up on it. */
const DRAIN_TIMEOUT_MS = 5000;

/**
 * Send a response, waiting first for any unread request body.
 *
 * An upload is rejected before its body has finished arriving, because the
 * permission check runs first by design — nothing is written to disk for an
 * unauthorised caller. Replying and closing while the client is still sending
 * resets the socket, and the caller sees a connection failure instead of the
 * 403 we actually produced. Draining the request first lets the client finish,
 * so the real status reaches it.
 */
function reply(req, res, status, body) {
  const send = () => {
    if (!res.headersSent) res.status(status).json(body);
  };

  if (req.complete || req.readableEnded) {
    send();
    return;
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    send();
  };
  // If the client stalls, answer anyway rather than holding the socket open.
  const timer = setTimeout(finish, DRAIN_TIMEOUT_MS);

  req.on('end', finish);
  req.on('error', finish);
  req.on('aborted', finish);
  req.resume();
}

/** Central error responder — never leaks stack traces or SQL to the client. */
export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    return reply(req, res, error.status, {
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  if (error?.name === 'ZodError') {
    return reply(req, res, 422, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please correct the highlighted fields',
        details: error.issues?.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return reply(req, res, 413, { error: { code: 'FILE_TOO_LARGE', message: 'The uploaded file is too large' } });
  }

  const message = String(error?.message || '');
  if (message.includes('UNIQUE constraint failed')) {
    const field = message.split(':').pop()?.trim();
    return reply(req, res, 409, {
      error: { code: 'DUPLICATE', message: `A record with this value already exists${field ? ` (${field})` : ''}` },
    });
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return reply(req, res, 409, {
      error: {
        code: 'REFERENCE_ERROR',
        message: 'This record is linked to other data, or a selected reference does not exist',
      },
    });
  }
  if (message.includes('NOT NULL constraint failed')) {
    const field = message.split(':').pop()?.trim();
    return reply(req, res, 422, {
      error: { code: 'VALIDATION_ERROR', message: `Required value missing${field ? ` (${field})` : ''}` },
    });
  }

  console.error('[error]', req.method, req.originalUrl, error);
  return reply(req, res, 500, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      ...(env.isProd ? {} : { debug: message }),
    },
  });
}
