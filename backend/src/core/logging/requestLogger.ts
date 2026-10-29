import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { logger } from '@/config/logger';
import { isTest } from '@/config/env';
import { requestContext } from '../context/requestContext';
import { RequestLogModel, type RequestLogDoc } from './requestLog.model';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FLUSH_MS = 2000;
const MAX_BUFFER = 200;

let buffer: Partial<RequestLogDoc>[] = [];
let timer: NodeJS.Timeout | null = null;
/** Reads are sampled; mutations are always kept (15_LOGGING_AND_MONITORING.md §1). */
let readSampleRate = 1;

export function setReadSampleRate(rate: number): void {
  readSampleRate = Math.min(1, Math.max(0, rate));
}

export async function flushRequestLogs(): Promise<void> {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  try {
    await RequestLogModel.insertMany(batch, { ordered: false });
  } catch (err) {
    logger.warn({ err }, 'request log flush failed');
  }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushRequestLogs();
  }, FLUSH_MS);
  timer.unref();
}

const oid = (v: unknown) =>
  v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : undefined;

/** Writes one `requestLogs` row per request, asynchronously and buffered, without bodies. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const routePath = (req.route as { path?: string } | undefined)?.path;
    const route = routePath ? `${req.baseUrl}${routePath}` : req.baseUrl || req.path;
    const ctx = requestContext.get();
    const auth = req.auth;
    const entry: Partial<RequestLogDoc> = {
      at: new Date(),
      reqId: req.id,
      sessionId: req.sessionId,
      method: req.method,
      route,
      path: req.path.slice(0, 300),
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      errorCode: res.locals.errorCode as string | undefined,
      userId: oid(auth?.userId ?? ctx?.userId),
      staffId: oid(auth?.staffId),
      clinicId: oid(auth?.clinicId ?? ctx?.clinicId),
      impersonatorUserId: oid(auth?.impersonatorUserId),
      ip: req.ip,
      userAgent: req.header('user-agent')?.slice(0, 300),
    };
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      {
        reqId: req.id,
        method: req.method,
        route,
        status: res.statusCode,
        ms: entry.durationMs,
        userId: auth?.userId,
        clinicId: auth?.clinicId,
      },
      'request',
    );
    if (isTest) return;
    const keep =
      MUTATING.has(req.method) || res.statusCode >= 400 || Math.random() < readSampleRate;
    if (!keep) return;
    buffer.push(entry);
    if (buffer.length >= MAX_BUFFER) void flushRequestLogs();
    else schedule();
  });
  next();
};
