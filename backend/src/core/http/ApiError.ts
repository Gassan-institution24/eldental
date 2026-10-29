export type ErrorDetails = Record<string, unknown>;

/** The only error type thrown on purpose. The global handler turns it into the envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(code = 'BAD_REQUEST', message = 'Malformed request', details?: ErrorDetails) {
    return new ApiError(400, code, message, details);
  }
  static unauthenticated(code = 'UNAUTHENTICATED', message = 'Authentication required') {
    return new ApiError(401, code, message);
  }
  static forbidden(code = 'FORBIDDEN', message = 'Not allowed', details?: ErrorDetails) {
    return new ApiError(403, code, message, details);
  }
  static notFound(code = 'NOT_FOUND', message = 'Not found') {
    return new ApiError(404, code, message);
  }
  static conflict(code: string, message: string, details?: ErrorDetails) {
    return new ApiError(409, code, message, details);
  }
  static validation(fields: ValidationField[]) {
    return new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', { fields });
  }
}

export type ValidationField = { path: string; code: string; params?: Record<string, unknown> };
