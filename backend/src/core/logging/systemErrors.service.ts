import { createHash } from 'node:crypto';
import { logger } from '@/config/logger';
import { requestContext } from '../context/requestContext';
import { SystemErrorModel } from './systemError.model';

export type RecordErrorInput = {
  error: unknown;
  source?: 'http' | 'job' | 'socket' | 'integration';
  integration?: 'whatsapp' | 'jofotara' | 'smtp' | 'storage';
  route?: string;
  method?: string;
  status?: number;
  code?: string;
};

type Listener = (doc: { fingerprint: string; message: string; isNew: boolean }) => void;
const listeners: Listener[] = [];

/** Lets the notifications module alert superadmins without a circular import. */
export function onSystemError(fn: Listener): void {
  listeners.push(fn);
}

/** Error name + first stack frame inside our code + route. Stable across occurrences. */
export function fingerprintOf(err: Error, route = ''): string {
  const frames = (err.stack ?? '').split('\n').slice(1);
  const top = frames.find((f) => /[\\/]src[\\/]/.test(f)) ?? frames[0] ?? '';
  const srcIdx = top.search(/[\\/]src[\\/]/);
  const frame = (srcIdx >= 0 ? top.slice(srcIdx) : top).replace(/:\d+:\d+\)?\s*$/, '').trim();
  return createHash('sha256')
    .update(`${err.name}|${frame}|${route}`)
    .digest('hex')
    .slice(0, 32);
}

/** Creates or increments a `systemErrors` row. Never throws. */
export async function recordSystemError(input: RecordErrorInput): Promise<string | null> {
  try {
    const err = input.error instanceof Error ? input.error : new Error(String(input.error));
    const ctx = requestContext.get();
    const fingerprint = fingerprintOf(err, input.route);
    const now = new Date();
    const res = await SystemErrorModel.findOneAndUpdate(
      { fingerprint },
      {
        $setOnInsert: { fingerprint, firstAt: now, name: err.name },
        $set: {
          message: err.message.slice(0, 2000),
          stack: err.stack?.slice(0, 8000),
          route: input.route,
          method: input.method,
          httpStatus: input.status ?? 500,
          code: input.code ?? 'INTERNAL_ERROR',
          source: input.source ?? 'http',
          integration: input.integration,
          reqId: ctx?.reqId,
          sessionId: ctx?.sessionId,
          userId: ctx?.userId,
          clinicId: ctx?.clinicId,
          lastAt: now,
        },
        $inc: { occurrences: 1 },
        $push: { lastReqIds: { $each: ctx?.reqId ? [ctx.reqId] : [], $slice: -20 } },
      },
      { upsert: true, new: true, includeResultMetadata: true },
    );
    const isNew = !res.lastErrorObject?.updatedExisting;
    // A resolved error that happens again is re-opened.
    if (!isNew && res.value?.status === 'resolved') {
      await SystemErrorModel.updateOne(
        { fingerprint },
        { $set: { status: 'new' }, $unset: { resolvedAt: 1 } },
      );
    }
    for (const l of listeners) l({ fingerprint, message: err.message, isNew });
    return fingerprint;
  } catch (e) {
    logger.error({ err: e }, 'failed to record system error');
    return null;
  }
}
