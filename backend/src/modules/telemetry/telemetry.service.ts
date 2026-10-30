import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { logger } from '@/config/logger';
import type { AuthContext } from '@/core/auth/auth.types';
import { requestContext } from '@/core/context/requestContext';
import { ActivityLogModel, ClientIssueModel, type ActivityLog } from '@/core/logging/telemetry.models';
import type { activityBody, issuesBody } from './telemetry.schemas';

type Who = { auth?: AuthContext; sessionId?: string; appVersion?: string; locale?: string };

const oid = (v?: string) => (v && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : undefined);

function common(w: Who) {
  const ctx = requestContext.get();
  return {
    clinicId: oid(w.auth?.clinicId),
    userId: oid(w.auth?.userId),
    staffId: oid(w.auth?.staffId),
    impersonatorUserId: oid(w.auth?.impersonatorUserId),
    sessionId: w.sessionId ?? ctx?.sessionId,
    reqId: ctx?.reqId,
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
    appVersion: w.appVersion,
    locale: w.locale,
  };
}

export async function recordActivity(body: z.infer<typeof activityBody>, who: Who): Promise<number> {
  const base = common({ ...who, sessionId: body.sessionId ?? who.sessionId, appVersion: body.appVersion });
  const docs = body.events.map((e) => ({ ...base, ...e, at: e.at ?? new Date() }));
  await ActivityLogModel.insertMany(docs, { ordered: false });
  return docs.length;
}

/** Groups by kind + code + route + top stack frame so the board shows one row per problem. */
export function issueFingerprint(i: { kind: string; code?: string; route: string; message?: string; stack?: string; api?: { method: string; path: string } }): string {
  const frame = (i.stack ?? '').split('\n').find((l) => l.includes('/src/') || l.includes('at ')) ?? '';
  const api = i.api ? `${i.api.method} ${i.api.path.replace(/[a-f0-9]{24}/g, ':id')}` : '';
  const msg = i.kind === 'js_error' ? (i.message ?? '').replace(/\d+/g, 'N').slice(0, 120) : '';
  return createHash('sha256').update([i.kind, i.code ?? '', i.route.replace(/[a-f0-9]{24}/g, ':id'), api, frame.trim(), msg].join('|')).digest('hex').slice(0, 32);
}

export async function recordIssues(body: z.infer<typeof issuesBody>, who: Who, saveScreenshot?: (dataUrl: string, clinicId?: string) => Promise<Types.ObjectId | undefined>): Promise<number> {
  const base = common({ ...who, sessionId: body.sessionId ?? who.sessionId, appVersion: body.appVersion });
  for (const issue of body.issues) {
    const { screenshot, ...rest } = issue;
    const fingerprint = issueFingerprint(issue);
    const at = issue.at ?? new Date();
    // User reports are always their own row; everything else is grouped.
    if (issue.kind === 'user_report') {
      const screenshotFileId = screenshot && saveScreenshot ? await saveScreenshot(screenshot, who.auth?.clinicId) : undefined;
      await ClientIssueModel.create({ ...base, ...rest, at, fingerprint, firstAt: at, lastAt: at, usersAffected: base.userId ? [base.userId] : [], screenshotFileId });
      continue;
    }
    const existing = await ClientIssueModel.findOneAndUpdate(
      { fingerprint, clinicId: base.clinicId ?? null },
      {
        $inc: { occurrences: 1 },
        $set: { lastAt: at, message: rest.message, sessionId: base.sessionId, reqId: base.reqId, ...(rest.api ? { api: rest.api } : {}) },
        ...(base.userId ? { $addToSet: { usersAffected: base.userId } } : {}),
      },
      { new: true },
    );
    if (existing) {
      if (existing.status === 'resolved') await ClientIssueModel.updateOne({ _id: existing._id }, { $set: { status: 'new' } });
      // Keep each occurrence on the timeline too: a lightweight activity row.
      await ActivityLogModel.create({ ...base, type: 'action', route: rest.route, action: `issue.${rest.kind}`, meta: { fingerprint, code: rest.code ?? null }, at });
      continue;
    }
    await ClientIssueModel.create({ ...base, ...rest, at, fingerprint, firstAt: at, lastAt: at, usersAffected: base.userId ? [base.userId] : [] });
  }
  return body.issues.length;
}

/** Backend API action summaries for the activity stream (15 §1). Buffered. */
let apiBuffer: Partial<ActivityLog>[] = [];
let timer: NodeJS.Timeout | null = null;

export function recordApiAction(entry: Partial<ActivityLog>): void {
  apiBuffer.push({ ...entry, type: 'api_action', at: new Date() });
  if (apiBuffer.length >= 100) void flushApiActions();
  else if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flushApiActions();
    }, 2000);
    timer.unref();
  }
}

export async function flushApiActions(): Promise<void> {
  if (!apiBuffer.length) return;
  const batch = apiBuffer;
  apiBuffer = [];
  try {
    await ActivityLogModel.insertMany(batch, { ordered: false });
  } catch (err) {
    logger.warn({ err }, 'api action flush failed');
  }
}
