import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env, isProd } from '@/config/env';
import { logger } from '@/config/logger';
import { recordSystemError } from '../logging/systemErrors.service';
import { zodErrorToFields } from '../validation/zodIssues';
import { ApiError } from './ApiError';

type MongoServerError = Error & { code?: number; keyValue?: Record<string, unknown> };
type MulterLikeError = Error & { code?: string; field?: string };

/** Maps known library errors to an ApiError; returns null for real bugs (→ 500). */
export function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) return ApiError.validation(zodErrorToFields(err));
  if (err instanceof mongoose.Error.VersionError) {
    return ApiError.conflict('VERSION_CONFLICT', 'The record was changed by someone else.');
  }
  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest('INVALID_ID', `Invalid value for ${err.path}`);
  }
  if (err instanceof mongoose.Error.StrictModeError) {
    return ApiError.validation([{ path: err.path, code: 'unknown_field' }]);
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      Object.values(err.errors).map((e) => ({ path: e.path, code: e.kind === 'required' ? 'required' : 'invalid' })),
    );
  }
  const mongoErr = err as MongoServerError;
  if (mongoErr?.name === 'MongoServerError' && mongoErr.code === 11000) {
    const fields = Object.keys(mongoErr.keyValue ?? {}).filter((k) => k !== 'clinicId');
    return ApiError.conflict('DUPLICATE', 'A record with the same value already exists.', { fields });
  }
  const multerErr = err as MulterLikeError;
  if (multerErr?.name === 'MulterError') {
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      return ApiError.validation([
        { path: multerErr.field ?? 'file', code: 'file_too_large', params: { max: env.MAX_UPLOAD_MB } },
      ]);
    }
    return ApiError.badRequest('UPLOAD_ERROR', multerErr.message);
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    return ApiError.badRequest('MALFORMED_JSON', 'Request body is not valid JSON');
  }
  const typed = err as { type?: string; status?: number };
  if (typed?.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  return null;
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound('ROUTE_NOT_FOUND', `No route ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiErr = toApiError(err);
  const route = (req.route as { path?: string } | undefined)?.path
    ? `${req.baseUrl}${(req.route as { path: string }).path}`
    : req.path;

  if (apiErr) {
    res.locals.errorCode = apiErr.code;
    if (apiErr.status === 401 && apiErr.code !== 'TOKEN_EXPIRED') {
      res.setHeader('WWW-Authenticate', 'Bearer');
    }
    return res.status(apiErr.status).json({
      error: {
        code: apiErr.code,
        message: apiErr.message,
        ...(apiErr.details ? { details: apiErr.details } : {}),
        requestId: req.id,
      },
    });
  }

  res.locals.errorCode = 'INTERNAL_ERROR';
  logger.error({ err, reqId: req.id, route }, 'unhandled error');
  void recordSystemError({ error: err, source: 'http', route, method: req.method, status: 500 });
  const e = err as Error;
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProd ? 'Something went wrong.' : e?.message ?? 'Internal error',
      ...(isProd ? {} : { details: { stack: e?.stack?.split('\n').slice(0, 8) } }),
      requestId: req.id,
    },
  });
};
