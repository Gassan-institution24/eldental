import type { RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit, type Options, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env, isTest } from '@/config/env';
import { getRedis } from '@/config/redis';
import { ApiError } from './ApiError';

export const helmetMiddleware = helmet({
  // The API only serves JSON (and Swagger UI in dev), so the CSP can be strict.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      // Swagger UI needs these in dev only; it is disabled in production by default.
      scriptSrc: env.ENABLE_API_DOCS || env.NODE_ENV !== 'production' ? ["'self'", "'unsafe-inline'"] : ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
});

/** CORS allow-list. Never `*` (11_SECURITY.md §4). */
export const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / server-to-server / curl
    if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  exposedHeaders: ['X-Request-Id', 'Location', 'Retry-After'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Session-Id',
    'X-Request-Id',
    'Idempotency-Key',
    'X-App-Version',
    'Accept-Language',
  ],
  maxAge: 600,
});

function redisStore(prefix: string): Store | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
}

function limiter(prefix: string, opts: Partial<Options>): RequestHandler {
  if (isTest) return (_req, _res, next) => next();
  const store = redisStore(prefix);
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(store ? { store } : {}),
    handler: (_req, _res, next, options) =>
      next(new ApiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfterMs: options.windowMs })),
    ...opts,
  });
}

export const globalRateLimit = limiter('global', { limit: env.RATE_LIMIT_MAX });
export const authRateLimit = limiter('auth', { limit: env.AUTH_RATE_LIMIT_MAX });
export const publicBookingRateLimit = limiter('public', { limit: 20 });
export const exportRateLimit = limiter('export', {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anon',
});

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth: browser requests (they carry an Origin) that mutate must send
 * `X-Requested-With`, which a cross-site form cannot set (05_API_CONVENTIONS.md §2).
 * Beacon telemetry is exempt because `navigator.sendBeacon` cannot set headers.
 */
export const requireXhrHeader: RequestHandler = (req, _res, next) => {
  if (!MUTATING.has(req.method) || !req.header('origin')) return next();
  if (req.path.startsWith(`${env.API_PREFIX}/telemetry/`)) return next();
  if (req.header('x-requested-with') === 'XMLHttpRequest') return next();
  next(ApiError.forbidden('CSRF_HEADER_MISSING', 'X-Requested-With header required'));
};
