import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load backend/.env when present. Tests set their own variables before importing this module.
const envFile = resolve(process.cwd(), '.env');
if (process.env.NODE_ENV !== 'test' && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PREFIX: z.string().default('/api/v1'),
    APP_NAME: z.string().default('ElDental'),
    APP_VERSION: z.string().default('0.1.0'),
    API_PUBLIC_URL: z.string().url(),
    FRONTEND_URL: z.string().url(),
    /** A frontend `dist` folder this process serves (single-origin hosting); empty = API only. */
    FRONTEND_DIST_DIR: z.string().default(''),
    CORS_ORIGINS: csv,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    ENABLE_API_DOCS: bool,
    RUN_WORKERS_IN_PROCESS: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((v) => v === 'true' || v === '1'),

    MONGODB_URI: z.string().min(1),
    REDIS_URL: z
      .string()
      .trim()
      .min(1)
      // ioredis parses it with WHATWG URL; catch quotes, spaces and unresolved `${{...}}` references at boot.
      .refine((v) => /^rediss?:\/\/[^\s"'{}]+$/.test(v) && URL.canParse(v), 'must be a redis:// or rediss:// URL (no quotes or spaces)'),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_SECRET_PREVIOUS: z.string().min(32).optional(),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    REFRESH_COOKIE_NAME: z.string().default('eld_rt'),
    COOKIE_DOMAIN: z.string().default('localhost'),
    COOKIE_SECURE: bool,
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    FIELD_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex chars (32 bytes)'),

    SEED_SUPERADMIN_EMAIL: z.string().email().optional(),
    SEED_SUPERADMIN_PASSWORD: z.string().min(10).optional(),

    DEFAULT_TIMEZONE: z.string().default('Asia/Amman'),
    DEFAULT_CURRENCY: z.string().length(3).default('JOD'),
    DEFAULT_LOCALE: z.enum(['ar', 'en']).default('ar'),
    DEFAULT_COUNTRY_CODE: z.string().default('962'),

    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: bool,
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    MAIL_FROM: z.string().default('ElDental <no-reply@eldental.local>'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
    S3_ENDPOINT: z.string().optional().default(''),
    S3_REGION: z.string().optional().default(''),
    S3_BUCKET: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

    JOFOTARA_ENABLED: bool,
    JOFOTARA_BASE_URL: z.string().url().default('https://backend.jofotara.gov.jo/core/invoices/'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && !v.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
    }
    if (v.NODE_ENV === 'production' && v.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'wildcard is not allowed' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // The logger depends on env, so this one message goes straight to stderr.
  process.stderr.write(`\n[env] Invalid environment configuration:\n${lines}\n\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
