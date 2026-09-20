/** Typed application errors -> consistent HTTP responses. */
export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m = 'Invalid request', details) => new AppError(m, 400, 'BAD_REQUEST', details);
export const unauthorized = (m = 'Authentication required') => new AppError(m, 401, 'UNAUTHENTICATED');
export const forbidden = (m = 'You do not have permission to perform this action') =>
  new AppError(m, 403, 'FORBIDDEN');
export const notFound = (m = 'Resource not found') => new AppError(m, 404, 'NOT_FOUND');
export const conflict = (m = 'Resource already exists') => new AppError(m, 409, 'CONFLICT');
export const unprocessable = (m = 'Validation failed', details) => new AppError(m, 422, 'VALIDATION_ERROR', details);
