import { Types } from 'mongoose';
import { logger } from '@/config/logger';
import { requestContext } from '../context/requestContext';
import { AuditLogModel, type AuditLog } from './auditLog.model';

const SECRET_KEYS = /password|secret|token|otp|code$|apikey|iban(?!Last4)|nationalid(?!Last4)|passport/i;
const SKIP_KEYS = new Set(['updatedAt', 'createdAt', '__v', 'updatedBy', 'createdBy', 'searchName', 'version']);

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Types.ObjectId);
}

function normalise(v: unknown): unknown {
  if (v instanceof Types.ObjectId) return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalise);
  if (isPlainObject(v)) {
    const out: Plain = {};
    for (const [k, val] of Object.entries(v)) {
      if (SKIP_KEYS.has(k)) continue;
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : normalise(val);
    }
    return out;
  }
  return v;
}

/** Shallow diff by top-level path; only changed keys are stored (03 §3 "diff only"). */
export function diff(before: unknown, after: unknown): { before: Plain; after: Plain } {
  const b = (normalise(before) ?? {}) as Plain;
  const a = (normalise(after) ?? {}) as Plain;
  const out = { before: {} as Plain, after: {} as Plain };
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === '_id' || k === 'id') continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
      if (k in b) out.before[k] = b[k];
      if (k in a) out.after[k] = a[k];
    }
  }
  return out;
}

export type AuditInput = {
  action: AuditLog['action'];
  entity: string;
  entityId?: string | Types.ObjectId;
  before?: unknown;
  after?: unknown;
  summary?: string;
  resource?: string;
  reason?: string;
  clinicId?: string | Types.ObjectId | null;
  actorUserId?: string | Types.ObjectId;
  actorName?: string;
  platformAccess?: boolean;
};

/** `auditService.record` — never throws, never stores secrets (15 §2). */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const ctx = requestContext.get();
    const changes = input.before !== undefined || input.after !== undefined ? diff(input.before, input.after) : null;
    const clinicId = input.clinicId === null ? undefined : (input.clinicId ?? ctx?.clinicId);
    await AuditLogModel.create({
      clinicId,
      actorUserId: input.actorUserId ?? ctx?.userId,
      actorStaffId: ctx?.staffId,
      actorName: input.actorName,
      impersonatorUserId: ctx?.impersonatorUserId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ? String(input.entityId) : undefined,
      summary: input.summary,
      resource: input.resource,
      reason: input.reason,
      before: changes?.before,
      after: changes?.after,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
      reqId: ctx?.reqId,
      sessionId: ctx?.sessionId,
      platformAccess: input.platformAccess ?? false,
    });
  } catch (err) {
    logger.error({ err }, 'audit write failed');
  }
}

export const auditService = { record: recordAudit, diff };
