import pino from 'pino';
import { env, isProd, isTest } from './env';

/** Paths removed from every log line (see 11_SECURITY.md §7 and 15_LOGGING_AND_MONITORING.md §2). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.code',
  '*.otp',
  '*.secret',
  '*.secretKey',
  '*.apiKey',
  '*.nationalId',
  '*.passportNo',
  '*.iban',
  '*.phone',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'nationalId',
];

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: { app: env.APP_NAME, v: env.APP_VERSION },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProd || isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }),
});

export type Logger = typeof logger;
