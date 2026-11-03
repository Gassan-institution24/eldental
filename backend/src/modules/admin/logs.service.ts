import { Types, type Model } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import type { AuthContext } from '@/core/auth/auth.types';
import { ApiError } from '@/core/http/ApiError';
import { RequestLogModel } from '@/core/logging/requestLog.model';
import { SystemErrorModel } from '@/core/logging/systemError.model';
import { ActivityLogModel, ClientIssueModel } from '@/core/logging/telemetry.models';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { UserModel } from '@/modules/users/user.model';
import { toCsv } from '@/shared/csv';
import { escapeRegex } from '@/shared/validation/normalize';

/** Platform log viewer (15 §6): five kinds, filters, CSV, a per-user session timeline. */
export const LOG_KINDS = ['audit', 'activity', 'issues', 'errors', 'requests'] as const;
export type LogKind = (typeof LOG_KINDS)[number];
export const LOG_PERMISSION: Record<LogKind, string> = {
  audit: 'platform.logs.audit.read',
  activity: 'platform.logs.activity.read',
  issues: 'platform.logs.issues.read',
  errors: 'platform.logs.errors.read',
  requests: 'platform.logs.requests.read',
};

export type LogQuery = { page: number; limit: number; clinicId?: string; userId?: string; from?: string; to?: string; q?: string; status?: string; type?: string };

type Raw = Record<string, unknown> & { _id: Types.ObjectId };
const oid = (v: string) => new Types.ObjectId(v);
const range = (from?: string, to?: string) => (from || to ? { ...(from ? { $gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59Z`) } : {}) } : undefined);
const rx = (q: string) => ({ $regex: escapeRegex(q.trim()), $options: 'i' });

type AnyModel = Model<Record<string, unknown>>;
type KindDef = { model: AnyModel; time: string; user?: string; filter: (q: LogQuery) => Record<string, unknown>; columns: string[] };

const KINDS: Record<LogKind, KindDef> = {
  audit: {
    model: AuditLogModel as unknown as AnyModel,
    time: 'at',
    user: 'actorUserId',
    filter: (q) => ({ ...(q.type ? { action: q.type } : {}), ...(q.q ? { $or: [{ entity: rx(q.q) }, { summary: rx(q.q) }, { actorName: rx(q.q) }] } : {}) }),
    columns: ['at', 'clinic', 'actorName', 'action', 'entity', 'entityId', 'summary', 'reason', 'ip'],
  },
  activity: {
    model: ActivityLogModel as unknown as AnyModel,
    time: 'at',
    user: 'userId',
    filter: (q) => ({ ...(q.type ? { type: q.type } : {}), ...(q.q ? { $or: [{ route: rx(q.q) }, { action: rx(q.q) }, { entity: rx(q.q) }] } : {}) }),
    columns: ['at', 'clinic', 'user', 'type', 'route', 'action', 'entity', 'durationMs'],
  },
  issues: {
    model: ClientIssueModel as unknown as AnyModel,
    time: 'lastAt',
    user: 'userId',
    filter: (q) => ({ ...(q.status ? { status: q.status } : {}), ...(q.type ? { kind: q.type } : {}), ...(q.q ? { $or: [{ message: rx(q.q) }, { route: rx(q.q) }, { code: rx(q.q) }] } : {}) }),
    columns: ['lastAt', 'clinic', 'kind', 'severity', 'status', 'message', 'route', 'occurrences'],
  },
  errors: {
    model: SystemErrorModel as unknown as AnyModel,
    time: 'lastAt',
    user: 'userId',
    filter: (q) => ({ ...(q.status ? { status: q.status } : {}), ...(q.type ? { source: q.type } : {}), ...(q.q ? { $or: [{ message: rx(q.q) }, { route: rx(q.q) }, { code: rx(q.q) }] } : {}) }),
    columns: ['lastAt', 'clinic', 'source', 'status', 'httpStatus', 'code', 'message', 'route', 'occurrences'],
  },
  requests: {
    model: RequestLogModel as unknown as AnyModel,
    time: 'at',
    user: 'userId',
    filter: (q) => ({
      ...(q.status === 'errors' ? { status: { $gte: 400 } } : q.status && /^\d{3}$/.test(q.status) ? { status: Number(q.status) } : {}),
      ...(q.type ? { method: q.type.toUpperCase() } : {}),
      ...(q.q ? { $or: [{ path: rx(q.q) }, { route: rx(q.q) }, { errorCode: rx(q.q) }] } : {}),
    }),
    columns: ['at', 'clinic', 'user', 'method', 'path', 'status', 'durationMs', 'errorCode'],
  },
};

function filterOf(kind: LogKind, q: LogQuery) {
  const def = KINDS[kind];
  const f: Record<string, unknown> = def.filter(q);
  if (q.clinicId) f.clinicId = oid(q.clinicId);
  if (q.userId && def.user) f[def.user] = oid(q.userId);
  const r = range(q.from, q.to);
  if (r) f[def.time] = r;
  return f;
}

/** Adds clinic and user names; never returns stack traces of other fields than the record's own. */
async function decorate(rows: Raw[]) {
  const ids = (k: string) => [...new Set(rows.map((r) => r[k]).filter(Boolean).map(String))];
  const [clinics, users] = await Promise.all([
    ClinicModel.find({ _id: { $in: ids('clinicId') } }).select('name').lean(),
    UserModel.find({ _id: { $in: [...ids('userId'), ...ids('actorUserId')] } }).select('displayName email').lean(),
  ]);
  const clinic = new Map(clinics.map((c) => [String(c._id), c.name]));
  const user = new Map(users.map((u) => [String(u._id), u.displayName || u.email || '']));
  return rows.map(({ _id, __v: _v, ...r }) => ({
    id: String(_id),
    ...r,
    clinic: r.clinicId ? (clinic.get(String(r.clinicId)) ?? '') : '',
    user: r.userId ? (user.get(String(r.userId)) ?? '') : r.actorUserId ? (user.get(String(r.actorUserId)) ?? '') : '',
  }));
}

export async function listLogs(kind: LogKind, q: LogQuery) {
  return runWithoutTenant(async () => {
    const def = KINDS[kind];
    const filter = filterOf(kind, q);
    const [rows, total] = await Promise.all([
      def.model.find(filter).sort({ [def.time]: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      def.model.countDocuments(filter),
    ]);
    return { total, items: await decorate(rows as unknown as Raw[]) };
  });
}

/** CSV export of the current filter (max 5,000 rows), audited as an export (15 §6). */
export async function exportLogs(auth: AuthContext, kind: LogKind, q: LogQuery) {
  const rows = await runWithoutTenant(async () => {
    const def = KINDS[kind];
    return decorate((await def.model.find(filterOf(kind, q)).sort({ [def.time]: -1 }).limit(5000).lean()) as unknown as Raw[]);
  });
  await recordAudit({ action: 'export', entity: `log.${kind}`, clinicId: null, actorUserId: auth.userId, summary: `${rows.length} rows` });
  const columns = KINDS[kind].columns;
  return toCsv(columns, rows.map((r) => Object.fromEntries(columns.map((c) => {
    const v = (r as Record<string, unknown>)[c];
    return [c, v instanceof Date ? v.toISOString() : v];
  }))));
}

export async function updateLogItem(auth: AuthContext, kind: 'issues' | 'errors', id: string, b: { status?: string; notes?: string; assigneeId?: string | null }) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound();
  return runWithoutTenant(async () => {
    const model = (kind === 'issues' ? ClientIssueModel : SystemErrorModel) as unknown as Model<Record<string, unknown>>;
    const doc = await model.findById(id);
    if (!doc) throw ApiError.notFound();
    const before = { status: doc.get('status'), notes: doc.get('notes'), assigneeId: doc.get('assigneeId') };
    if (b.status !== undefined) {
      doc.set('status', b.status);
      if (kind === 'errors') {
        doc.set('resolvedAt', b.status === 'resolved' ? new Date() : undefined);
        doc.set('resolvedBy', b.status === 'resolved' ? oid(auth.userId) : undefined);
      }
    }
    if (b.notes !== undefined) doc.set('notes', b.notes);
    if (b.assigneeId !== undefined) doc.set('assigneeId', b.assigneeId ? oid(b.assigneeId) : undefined);
    await doc.save();
    await recordAudit({ action: 'update', entity: kind === 'issues' ? 'clientIssue' : 'systemError', entityId: id, clinicId: null, before, after: b });
    return (await decorate([doc.toObject() as Raw]))[0];
  });
}

/**
 * User session timeline (15 §7): pages, actions, audit events, validation/JS issues and failed
 * requests of one user (or one session), oldest first.
 */
export async function timeline(q: { userId?: string; sessionId?: string; from?: string; to?: string }) {
  if (!q.userId && !q.sessionId) throw ApiError.validation([{ path: 'userId', code: 'required' }]);
  return runWithoutTenant(async () => {
    const to = q.to ? new Date(`${q.to}T23:59:59Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 86_400_000);
    const who = (userField: string) => ({ ...(q.userId ? { [userField]: oid(q.userId) } : {}), ...(q.sessionId ? { sessionId: q.sessionId } : {}) });
    const [activity, audit, issues, requests] = await Promise.all([
      ActivityLogModel.find({ ...who('userId'), at: { $gte: from, $lte: to } }).sort({ at: 1 }).limit(500).lean(),
      AuditLogModel.find({ ...who('actorUserId'), at: { $gte: from, $lte: to } }).sort({ at: 1 }).limit(300).lean(),
      ClientIssueModel.find({ ...who('userId'), lastAt: { $gte: from, $lte: to } }).sort({ lastAt: 1 }).limit(200).lean(),
      RequestLogModel.find({ ...who('userId'), at: { $gte: from, $lte: to }, status: { $gte: 400 } }).sort({ at: 1 }).limit(300).lean(),
    ]);
    const events = [
      ...activity.map((a) => ({ at: a.at, kind: 'activity' as const, type: a.type, label: a.route ?? a.action ?? '', sessionId: a.sessionId, clinicId: a.clinicId })),
      ...audit.map((a) => ({ at: a.at, kind: 'audit' as const, type: a.action, label: `${a.entity}${a.summary ? ` · ${a.summary}` : ''}`, sessionId: a.sessionId, clinicId: a.clinicId })),
      ...issues.map((i) => ({ at: i.lastAt, kind: 'issue' as const, type: i.kind, label: i.message ?? i.code ?? '', sessionId: i.sessionId, clinicId: i.clinicId })),
      ...requests.map((r) => ({ at: r.at, kind: 'request' as const, type: String(r.status ?? ''), label: `${r.method ?? ''} ${r.path ?? ''}${r.errorCode ? ` · ${r.errorCode}` : ''}`, sessionId: r.sessionId, clinicId: r.clinicId })),
    ].sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime());
    return { from, to, events: events.map((e) => ({ ...e, clinicId: e.clinicId ? String(e.clinicId) : null })) };
  });
}
