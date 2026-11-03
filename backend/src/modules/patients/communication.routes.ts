import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok, pageMeta } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { body, params, query, validate } from '@/core/validation/validate';
import { StaffModel } from '@/modules/staff/staff.model';
import { pageQuery, skipOf } from '@/shared/pagination';
import { COMM_EDIT_WINDOW_MS, communicationBody, communicationPatch } from '@/shared/patients';
import { objectId } from '@/shared/validation/fields';
import { CommunicationModel } from './communication.model';
import { registerTimelineSource } from './patient.routes';
import * as svc from './patient.service';

/** Patient communication log (03 §4): calls, messages and visits, with follow-ups. */
export const communicationRouter = Router();

const idParams = z.object({ id: objectId() });
const createBody = communicationBody();
const patchBody = communicationPatch();
const listQuery = z.object({ page: pageQuery.page, limit: pageQuery.limit, due: z.enum(['true', 'false']).optional() }).strict();

type CommDoc = {
  _id: Types.ObjectId;
  patientId: Types.ObjectId;
  at: Date;
  channel: string;
  direction: string;
  summary: string;
  outcome: string;
  followUpAt?: Date | null;
  followUpDoneAt?: Date | null;
  followUpDoneBy?: Types.ObjectId | null;
  staffId: Types.ObjectId;
  createdAt?: Date;
  __v?: number;
};

const dueFilter = () => ({ followUpAt: { $lte: new Date() }, followUpDoneAt: null });

function editable(c: CommDoc, auth: AuthContext) {
  return String(c.staffId) === auth.staffId && Date.now() - (c.createdAt?.getTime() ?? 0) < COMM_EDIT_WINDOW_MS;
}

async function toDtos(list: CommDoc[], auth: AuthContext) {
  const ids = [...new Set(list.flatMap((c) => [String(c.staffId), ...(c.followUpDoneBy ? [String(c.followUpDoneBy)] : [])]))];
  const staff = new Map((await StaffModel.find({ _id: { $in: ids } }).select('name').lean()).map((s) => [String(s._id), s.name as string]));
  return list.map((c) => ({
    id: String(c._id),
    version: c.__v ?? 0,
    patientId: String(c.patientId),
    at: c.at,
    channel: c.channel,
    direction: c.direction,
    summary: c.summary,
    outcome: c.outcome,
    followUpAt: c.followUpAt ?? undefined,
    followUpDoneAt: c.followUpDoneAt ?? undefined,
    followUpDoneByName: c.followUpDoneBy ? staff.get(String(c.followUpDoneBy)) : undefined,
    staffId: String(c.staffId),
    staffName: staff.get(String(c.staffId)),
    createdAt: c.createdAt,
    editable: editable(c, auth),
  }));
}

function requireStaff(auth: AuthContext): string {
  if (!auth.staffId) throw ApiError.forbidden();
  return auth.staffId;
}

communicationRouter.get(
  '/patients/:id/communications',
  authorize('patients.communication.read'),
  validate({ params: idParams, query: listQuery }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, idParams).id);
    const q = query(req, listQuery);
    const filter = { patientId: p._id, ...(q.due === 'true' ? dueFilter() : {}) };
    const [items, total, dueCount] = await Promise.all([
      CommunicationModel.find(filter).sort({ at: -1, _id: -1 }).skip(skipOf(q)).limit(q.limit).lean(),
      CommunicationModel.countDocuments(filter),
      CommunicationModel.countDocuments({ patientId: p._id, ...dueFilter() }),
    ]);
    ok(res, await toDtos(items as unknown as CommDoc[], req.auth!), { ...pageMeta(q.page, q.limit, total), dueCount });
  }),
);

communicationRouter.post(
  '/patients/:id/communications',
  authorize('patients.communication.write'),
  validate({ params: idParams, body: createBody }),
  asyncHandler(async (req, res) => {
    const staffId = requireStaff(req.auth!);
    const p = await svc.loadScopedPatient(req.auth!, params(req, idParams).id);
    const b = body(req, createBody);
    const c = await CommunicationModel.create({ ...b, at: b.at ?? new Date(), patientId: p._id, staffId });
    await recordAudit({
      action: 'create',
      entity: 'patientCommunication',
      entityId: c._id,
      summary: `${b.channel} ${b.direction}`,
      after: { patientId: String(p._id), channel: b.channel, direction: b.direction, outcome: b.outcome, followUp: Boolean(b.followUpAt) },
    });
    created(res, (await toDtos([c.toObject() as unknown as CommDoc], req.auth!))[0]);
  }),
);

/** The author corrects an entry within 24 h; anyone who may write marks the follow-up done. */
communicationRouter.patch(
  '/patient-communications/:id',
  authorize('patients.communication.write'),
  validate({ params: idParams, body: patchBody }),
  asyncHandler(async (req, res) => {
    const staffId = requireStaff(req.auth!);
    const c = await CommunicationModel.findById(params(req, idParams).id);
    if (!c) throw ApiError.notFound();
    await svc.loadScopedPatient(req.auth!, String(c.patientId));
    const { followUpDone, ...content } = body(req, patchBody);
    if (Object.keys(content).length && !editable(c.toObject() as unknown as CommDoc, req.auth!))
      throw ApiError.forbidden('COMMUNICATION_LOCKED', 'Only the author can change an entry, within 24 hours');
    for (const [k, v] of Object.entries(content)) c.set(k, v ?? undefined);
    if (followUpDone === true && !c.followUpDoneAt) {
      c.followUpDoneAt = new Date();
      c.followUpDoneBy = new Types.ObjectId(staffId);
    }
    if (followUpDone === false) {
      c.set('followUpDoneAt', undefined);
      c.set('followUpDoneBy', undefined);
    }
    await c.save();
    await recordAudit({
      action: 'update',
      entity: 'patientCommunication',
      entityId: c._id,
      summary: followUpDone === undefined ? 'edited' : followUpDone ? 'follow-up done' : 'follow-up reopened',
      after: { patientId: String(c.patientId), fields: Object.keys(content) },
    });
    ok(res, (await toDtos([c.toObject() as unknown as CommDoc], req.auth!))[0]);
  }),
);

registerTimelineSource('patients.communication.read', async (patientId, auth) => {
  if (scopeFor(auth, 'patients.communication.read') === 'own') {
    const inScope = await svc.loadScopedPatient({ ...auth, scope: 'own' }, String(patientId)).then(
      () => true,
      () => false,
    );
    if (!inScope) return [];
  }
  const items = await CommunicationModel.find({ patientId }).sort({ at: -1 }).limit(30).select('at channel direction outcome').lean();
  return items.map((c) => ({ at: c.at, kind: `communication.${c.channel}`, title: '', ref: 'communication' }));
});

svc.onPatientMerge(async (sourceId, targetId) => {
  await CommunicationModel.updateMany({ patientId: sourceId }, { $set: { patientId: targetId } });
});

registerPath({ method: 'get', path: '/patients/:id/communications', tags: ['patients'], summary: 'Communication log (newest first; meta.dueCount)', params: idParams, query: listQuery });
registerPath({ method: 'post', path: '/patients/:id/communications', tags: ['patients'], summary: 'Log a call, message or visit', params: idParams, body: createBody });
registerPath({ method: 'patch', path: '/patient-communications/:id', tags: ['patients'], summary: 'Correct an entry (author, 24 h) or mark its follow-up done', params: idParams, body: patchBody });
