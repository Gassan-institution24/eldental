import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { crudRouter, defaultDto, updateOf } from '@/core/crud/crudRouter';
import { nextNumber } from '@/core/db/sequence';
import { on } from '@/core/events/bus';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { saveFile } from '@/core/storage/storage';
import { currentClinicId, runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { body, params, query, validate } from '@/core/validation/validate';
import { ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { loadScopedPatient, registerOwnPatientSource } from '@/modules/patients/patient.service';
import { registerTimelineSource } from '@/modules/patients/patient.routes';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { upsertRecall } from '@/modules/scheduling/planning.service';
import { AppointmentModel } from '@/modules/scheduling/scheduling.models';
import { registerCompletionCheck } from '@/modules/scheduling/scheduling.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, localDate } from '@/shared/dates';
import { addEntry, chartView, setDentition, voidEntry } from './chart.service';
import {
  ClinicalNoteModel,
  ConsentModel,
  ConsentTemplateModel,
  LabOrderModel,
  NoteTemplateModel,
  PerformedProcedureModel,
  PerioChartModel,
  PrescriptionModel,
  TreatmentPlanModel,
} from './clinical.models';
import * as s from './clinical.schemas';
import * as tx from './treatment.service';

export const clinicalRouter = Router();
const id = (v: unknown) => (v ? String(v) : undefined);

/** Every patient-level clinical route first loads the patient through the patient scope. */
async function patientOf(req: Request, patientId: string) {
  return loadScopedPatient(req.auth!, patientId);
}

/* ---------- chart ---------- */

clinicalRouter.get(
  '/patients/:patientId/chart',
  authorize('clinical.chart.read'),
  validate({ params: s.patientParams }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    ok(res, await chartView(String(p._id)));
  }),
);

clinicalRouter.post(
  '/patients/:patientId/chart/entries',
  authorize('clinical.chart.update'),
  validate({ params: s.patientParams, body: s.entryBody }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    const b = body(req, s.entryBody);
    const e = await addEntry(req.auth!, p._id, b);
    await recordAudit({ action: 'create', entity: 'chartEntry', entityId: e._id, after: { patientId: String(p._id), tooth: b.toothNumber, code: b.conditionCode ?? b.setStatus } });
    created(res, await chartView(String(p._id)));
  }),
);

clinicalRouter.post(
  '/patients/:patientId/chart/entries/:entryId/void',
  authorize('clinical.chart.update'),
  validate({ params: s.entryParams, body: s.voidBody }),
  asyncHandler(async (req, res) => {
    const pr = params(req, s.entryParams);
    const p = await patientOf(req, pr.patientId);
    await voidEntry(req.auth!, String(p._id), pr.entryId, body(req, s.voidBody).reason);
    ok(res, await chartView(String(p._id)));
  }),
);

clinicalRouter.put(
  '/patients/:patientId/chart/dentition',
  authorize('clinical.chart.update'),
  validate({ params: s.patientParams, body: s.dentitionBody }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    await setDentition(String(p._id), body(req, s.dentitionBody).dentition);
    ok(res, await chartView(String(p._id)));
  }),
);

/* ---------- treatment plans ---------- */

clinicalRouter.get(
  '/patients/:patientId/treatment-plans',
  authorize('clinical.treatmentPlan.read'),
  validate({ params: s.patientParams }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    ok(res, await tx.listPlans(req.auth!, String(p._id)));
  }),
);

clinicalRouter.get('/treatment-plans/:id', authorize('clinical.treatmentPlan.read'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await tx.getPlan(req.auth!, params(req, s.idParams).id))));

clinicalRouter.post(
  '/treatment-plans',
  authorize('clinical.treatmentPlan.create'),
  validate({ body: s.planBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.planBody);
    await patientOf(req, b.patientId);
    const plan = await tx.createPlan(req.auth!, b);
    created(res, plan, `/treatment-plans/${plan.id}`);
  }),
);

clinicalRouter.patch(
  '/treatment-plans/:id',
  authorize('clinical.treatmentPlan.update'),
  validate({ params: s.idParams, body: s.planUpdateBody }),
  asyncHandler(async (req, res) => ok(res, await tx.updatePlan(req.auth!, params(req, s.idParams).id, body(req, s.planUpdateBody)))),
);

clinicalRouter.post(
  '/treatment-plans/:id/present',
  authorize('clinical.treatmentPlan.present'),
  validate({ params: s.idParams, body: s.presentBody }),
  asyncHandler(async (req, res) => ok(res, await tx.presentPlan(req.auth!, params(req, s.idParams).id, body(req, s.presentBody).validUntil))),
);

clinicalRouter.post(
  '/treatment-plans/:id/accept',
  authorize('clinical.treatmentPlan.present'),
  validate({ params: s.idParams, body: s.acceptBody }),
  asyncHandler(async (req, res) => ok(res, await tx.acceptPlan(req.auth!, params(req, s.idParams).id, { ...body(req, s.acceptBody), ip: req.ip ?? '' }))),
);

clinicalRouter.post(
  '/treatment-plans/:id/status',
  authorize('clinical.treatmentPlan.update'),
  validate({ params: s.idParams, body: s.planStatusBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.planStatusBody);
    ok(res, await tx.setPlanStatus(req.auth!, params(req, s.idParams).id, b.to, b.reason));
  }),
);

/* ---------- performed procedures ---------- */

clinicalRouter.get(
  '/performed-procedures',
  authorize('clinical.chart.read'),
  validate({ query: s.procedureQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, s.procedureQuery);
    if (q.patientId) await patientOf(req, q.patientId);
    ok(res, await tx.listProcedures(req.auth!, q));
  }),
);

clinicalRouter.post(
  '/performed-procedures',
  authorize('clinical.procedure.perform'),
  validate({ body: s.performBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.performBody);
    await patientOf(req, b.patientId);
    created(res, await tx.performProcedure(req.auth!, b));
  }),
);

clinicalRouter.post(
  '/performed-procedures/:id/void',
  authorize('clinical.procedure.void'),
  validate({ params: s.idParams, body: s.voidBody }),
  asyncHandler(async (req, res) => ok(res, await tx.voidProcedure(req.auth!, params(req, s.idParams).id, body(req, s.voidBody).reason))),
);

/* ---------- clinical notes (07 §5) ---------- */

const noteDto = (n: Record<string, unknown> & { _id: Types.ObjectId; __v?: number }) => ({
  id: String(n._id),
  version: n.__v ?? 0,
  patientId: String(n.patientId),
  appointmentId: id(n.appointmentId),
  authorId: String(n.authorId),
  templateId: id(n.templateId),
  format: n.format,
  content: n.content ?? {},
  text: n.text ?? '',
  toothNumbers: n.toothNumbers ?? [],
  signedAt: n.signedAt,
  amendsNoteId: id(n.amendsNoteId),
  amendedById: id(n.amendedById),
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
});
const ownNotes = (auth: AuthContext, perm: string) => (scopeFor(auth, perm) === 'own' ? { authorId: new Types.ObjectId(auth.staffId) } : {});

clinicalRouter.get(
  '/patients/:patientId/notes',
  authorize('clinical.note.read'),
  validate({ params: s.patientParams }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    const rows = await ClinicalNoteModel.find({ patientId: p._id, ...ownNotes(req.auth!, 'clinical.note.read') }).sort({ createdAt: -1 }).limit(200).lean();
    ok(res, rows.map((r) => noteDto(r as never)));
  }),
);

/** Unsigned notes older than 24h (dentist to-do, 07 §5). */
clinicalRouter.get(
  '/notes/unsigned',
  authorize('clinical.note.write'),
  asyncHandler(async (req, res) => {
    const rows = await ClinicalNoteModel.find({ signedAt: null, authorId: req.auth!.staffId, createdAt: { $lt: new Date(Date.now() - 86_400_000) } }).sort({ createdAt: 1 }).limit(50).lean();
    ok(res, rows.map((r) => noteDto(r as never)));
  }),
);

clinicalRouter.post(
  '/notes',
  authorize('clinical.note.write'),
  validate({ body: s.noteBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.noteBody);
    await patientOf(req, b.patientId);
    if (!req.auth!.staffId) throw ApiError.forbidden();
    const n = await ClinicalNoteModel.create({ ...b, authorId: req.auth!.staffId });
    await recordAudit({ action: 'create', entity: 'clinicalNote', entityId: n._id, after: { patientId: b.patientId } });
    created(res, noteDto(n.toObject() as never));
  }),
);

async function loadNote(auth: AuthContext, noteId: string, perm: string) {
  const n = await ClinicalNoteModel.findOne({ _id: noteId, ...ownNotes(auth, perm) });
  if (!n) throw ApiError.notFound();
  return n;
}

clinicalRouter.patch(
  '/notes/:id',
  authorize('clinical.note.write'),
  validate({ params: s.idParams, body: s.noteUpdateBody }),
  asyncHandler(async (req, res) => {
    const n = await loadNote(req.auth!, params(req, s.idParams).id, 'clinical.note.write');
    const b = body(req, s.noteUpdateBody);
    if (n.signedAt) throw ApiError.conflict('NOTE_SIGNED', 'Signed notes cannot be edited; amend instead');
    if (b.version !== undefined && b.version !== n.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this note');
    if (b.content) n.set('content', b.content);
    if (b.text !== undefined) n.text = b.text;
    if (b.toothNumbers) n.toothNumbers = b.toothNumbers;
    await n.save();
    await recordAudit({ action: 'update', entity: 'clinicalNote', entityId: n._id });
    ok(res, noteDto(n.toObject() as never));
  }),
);

clinicalRouter.post(
  '/notes/:id/sign',
  authorize('clinical.note.sign'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const n = await loadNote(req.auth!, params(req, s.idParams).id, 'clinical.note.sign');
    if (n.signedAt) throw ApiError.conflict('NOTE_SIGNED', 'Already signed');
    if (!req.auth!.isOwner && String(n.authorId) !== req.auth!.staffId) throw ApiError.forbidden('FORBIDDEN', 'Only the author signs a note');
    n.signedAt = new Date();
    await n.save();
    await recordAudit({ action: 'status_change', entity: 'clinicalNote', entityId: n._id, after: { signed: true } });
    ok(res, noteDto(n.toObject() as never));
  }),
);

clinicalRouter.post(
  '/notes/:id/amend',
  authorize('clinical.note.write'),
  validate({ params: s.idParams, body: s.noteUpdateBody }),
  asyncHandler(async (req, res) => {
    const orig = await loadNote(req.auth!, params(req, s.idParams).id, 'clinical.note.read');
    if (!orig.signedAt) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Edit the draft instead of amending');
    if (orig.amendedById) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Amend the latest version');
    const b = body(req, s.noteUpdateBody);
    const n = await ClinicalNoteModel.create({
      patientId: orig.patientId,
      appointmentId: orig.appointmentId,
      authorId: req.auth!.staffId,
      format: orig.format,
      content: b.content ?? orig.content,
      text: b.text ?? orig.text,
      toothNumbers: b.toothNumbers ?? orig.toothNumbers,
      amendsNoteId: orig._id,
    });
    orig.amendedById = n._id;
    await orig.save();
    await recordAudit({ action: 'create', entity: 'clinicalNote', entityId: n._id, after: { amends: String(orig._id) } });
    created(res, noteDto(n.toObject() as never));
  }),
);

clinicalRouter.use(
  crudRouter({
    path: '/note-templates',
    entity: 'noteTemplate',
    tag: 'clinical',
    model: NoteTemplateModel as never,
    perms: { read: ['clinical.note.write', 'clinical.note.read'], create: ['clinic.settings.update', 'clinical.note.sign'] },
    createSchema: s.templateBody,
    updateSchema: updateOf(s.templateBody.shape),
    sortable: ['name', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => b.name as string,
    unpaged: true,
  }),
);

/* ---------- perio (07 §6) ---------- */

type PerioTooth = { pocketDepth: number[]; recession: number[]; bleeding: boolean[]; suppuration: boolean[]; mobility: number; furcation: number; missing?: boolean };
function perioSummary(teeth: Record<string, PerioTooth>) {
  const sites = Object.values(teeth).filter((t) => !t.missing).flatMap((t) => t.pocketDepth.map((pd, i) => ({ pd, cal: pd + (t.recession[i] ?? 0), bop: t.bleeding[i] })));
  const n = sites.length || 1;
  return {
    sites: sites.length,
    bopPercent: Math.round((sites.filter((x) => x.bop).length / n) * 1000) / 10,
    sites4mm: sites.filter((x) => x.pd >= 4).length,
    sites6mm: sites.filter((x) => x.pd >= 6).length,
    meanPd: Math.round((sites.reduce((a, x) => a + x.pd, 0) / n) * 10) / 10,
    meanCal: Math.round((sites.reduce((a, x) => a + x.cal, 0) / n) * 10) / 10,
  };
}
const perioDto = (p: Record<string, unknown> & { _id: Types.ObjectId; __v?: number }) => ({
  id: String(p._id),
  version: p.__v ?? 0,
  patientId: String(p.patientId),
  examDate: p.examDate,
  examinerId: String(p.examinerId),
  teeth: p.teeth,
  notes: p.notes ?? '',
  summary: perioSummary((p.teeth ?? {}) as Record<string, PerioTooth>),
  createdAt: p.createdAt,
});

clinicalRouter.get(
  '/patients/:patientId/perio',
  authorize('clinical.perio.read'),
  validate({ params: s.patientParams }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    const rows = await PerioChartModel.find({ patientId: p._id }).sort({ examDate: -1 }).limit(50).lean();
    ok(res, rows.map((r) => perioDto(r as never)));
  }),
);

clinicalRouter.post(
  '/perio',
  authorize('clinical.perio.write'),
  validate({ body: s.perioBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.perioBody);
    await patientOf(req, b.patientId);
    if (!req.auth!.staffId) throw ApiError.forbidden();
    const doc = await PerioChartModel.create({ ...b, examinerId: req.auth!.staffId });
    await recordAudit({ action: 'create', entity: 'perioChart', entityId: doc._id, after: { patientId: b.patientId } });
    created(res, perioDto(doc.toObject() as never));
  }),
);

clinicalRouter.patch(
  '/perio/:id',
  authorize('clinical.perio.write'),
  validate({ params: s.idParams, body: s.perioUpdateBody }),
  asyncHandler(async (req, res) => {
    const own = scopeFor(req.auth!, 'clinical.perio.write') === 'own' ? { examinerId: new Types.ObjectId(req.auth!.staffId) } : {};
    const doc = await PerioChartModel.findOne({ _id: params(req, s.idParams).id, ...own });
    if (!doc) throw ApiError.notFound();
    const b = body(req, s.perioUpdateBody);
    if (b.version !== undefined && b.version !== doc.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this exam');
    if (b.teeth) {
      doc.set('teeth', b.teeth);
      doc.markModified('teeth');
    }
    if (b.examDate) doc.examDate = b.examDate;
    if (b.notes !== undefined) doc.notes = b.notes;
    await doc.save();
    await recordAudit({ action: 'update', entity: 'perioChart', entityId: doc._id });
    ok(res, perioDto(doc.toObject() as never));
  }),
);

/* ---------- prescriptions (07 §7) ---------- */

const rxDto = (r: Record<string, unknown> & { _id: Types.ObjectId }) => ({ ...defaultDto(r as never), patientId: String(r.patientId), dentistId: String(r.dentistId), appointmentId: id(r.appointmentId) });

clinicalRouter.get(
  '/patients/:patientId/prescriptions',
  authorize('clinical.prescription.read'),
  validate({ params: s.patientParams }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    const rows = await PrescriptionModel.find({ patientId: p._id }).sort({ createdAt: -1 }).limit(100).lean();
    ok(res, rows.map((r) => rxDto(r as never)));
  }),
);

clinicalRouter.post(
  '/prescriptions',
  authorize('clinical.prescription.write'),
  validate({ body: s.prescriptionBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.prescriptionBody);
    await patientOf(req, b.patientId);
    const staff = await StaffModel.findById(req.auth!.staffId).select('staffType').lean();
    if (!staff || !['dentist', 'hygienist'].includes(staff.staffType)) throw ApiError.forbidden('FORBIDDEN', 'Only dentists write prescriptions');
    const year = new Date().getUTCFullYear();
    const doc = await PrescriptionModel.create({ ...b, dentistId: req.auth!.staffId, number: await nextNumber('prescription', 'RX', { year }) });
    await recordAudit({ action: 'create', entity: 'prescription', entityId: doc._id, after: { patientId: b.patientId, items: b.items.length } });
    created(res, rxDto(doc.toObject() as never));
  }),
);

/** Data for the printable prescription (letterhead, dentist license, items). */
clinicalRouter.get(
  '/prescriptions/:id/print',
  authorize('clinical.prescription.read'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const rx = await PrescriptionModel.findById(params(req, s.idParams).id);
    if (!rx) throw ApiError.notFound();
    const patient = await patientOf(req, String(rx.patientId));
    const [dentist, clinic] = await Promise.all([
      StaffModel.findById(rx.dentistId).select('name licenseNumber specialty signatureFileId stampFileId').lean(),
      runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name phone email address addressLine1 logoFileId settings.printLanguage').lean()),
    ]);
    rx.printedAt = new Date();
    await rx.save();
    await recordAudit({ action: 'print', entity: 'prescription', entityId: rx._id });
    ok(res, {
      prescription: rxDto(rx.toObject() as never),
      patient: { fullName: patient.fullName, fileNumber: patient.fileNumber, dateOfBirth: patient.dateOfBirth, gender: patient.gender, medicalAlerts: patient.medicalAlerts },
      dentist: dentist ? { name: dentist.name, licenseNumber: dentist.licenseNumber, specialty: dentist.specialty, signatureFileId: id(dentist.signatureFileId), stampFileId: id(dentist.stampFileId) } : null,
      clinic,
    });
  }),
);

/* ---------- lab orders (07 §8) ---------- */

const LAB_FLOW: Record<string, string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['in_progress', 'received', 'cancelled'],
  in_progress: ['received', 'cancelled'],
  received: ['fitted', 'remake'],
  remake: ['sent', 'cancelled'],
  fitted: ['remake'],
  cancelled: [],
};
const labDto = (l: Record<string, unknown> & { _id: Types.ObjectId }) => ({ ...defaultDto(l as never), patientId: String(l.patientId), dentistId: String(l.dentistId), labSupplierId: id(l.labSupplierId), treatmentPlanId: id(l.treatmentPlanId) });

clinicalRouter.get(
  '/lab-orders',
  authorize('clinical.labOrder.read'),
  validate({ query: s.labListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, s.labListQuery);
    if (q.patientId) await patientOf(req, q.patientId);
    const own = scopeFor(req.auth!, 'clinical.labOrder.read') === 'own' ? { dentistId: new Types.ObjectId(req.auth!.staffId) } : {};
    const filter = { ...own, ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.status ? { status: q.status } : q.open === 'true' ? { status: { $nin: ['fitted', 'cancelled'] } } : {}) };
    const rows = await LabOrderModel.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(300).lean();
    const patients = new Map((await PatientModel.find({ _id: { $in: rows.map((r) => r.patientId) } }).select('fullName fileNumber').lean()).map((p) => [String(p._id), { id: String(p._id), fullName: p.fullName, fileNumber: p.fileNumber }]));
    ok(res, rows.map((r) => ({ ...labDto(r as never), patient: patients.get(String(r.patientId)) })));
  }),
);

clinicalRouter.post(
  '/lab-orders',
  authorize('clinical.labOrder.manage'),
  validate({ body: s.labOrderBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.labOrderBody);
    await patientOf(req, b.patientId);
    if (!req.auth!.staffId) throw ApiError.forbidden();
    const doc = await LabOrderModel.create({ ...b, dentistId: req.auth!.staffId, number: await nextNumber('labOrder', 'LAB'), statusHistory: [{ to: 'draft', at: new Date() }] });
    await recordAudit({ action: 'create', entity: 'labOrder', entityId: doc._id, after: { patientId: b.patientId, lab: b.labName } });
    created(res, labDto(doc.toObject() as never));
  }),
);

async function loadLab(auth: AuthContext, labId: string) {
  const own = scopeFor(auth, 'clinical.labOrder.manage') === 'own' ? { dentistId: new Types.ObjectId(auth.staffId) } : {};
  const doc = await LabOrderModel.findOne({ _id: labId, ...own });
  if (!doc) throw ApiError.notFound();
  return doc;
}

clinicalRouter.patch(
  '/lab-orders/:id',
  authorize('clinical.labOrder.manage'),
  validate({ params: s.idParams, body: s.labOrderUpdateBody }),
  asyncHandler(async (req, res) => {
    const doc = await loadLab(req.auth!, params(req, s.idParams).id);
    const b = body(req, s.labOrderUpdateBody);
    if (b.version !== undefined && b.version !== doc.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this order');
    if (['fitted', 'cancelled'].includes(doc.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Closed orders cannot be edited');
    for (const k of ['labName', 'items', 'dueDate', 'notes', 'cost'] as const) if (b[k] !== undefined) doc.set(k, b[k]);
    await doc.save();
    await recordAudit({ action: 'update', entity: 'labOrder', entityId: doc._id });
    ok(res, labDto(doc.toObject() as never));
  }),
);

clinicalRouter.post(
  '/lab-orders/:id/status',
  authorize('clinical.labOrder.manage'),
  validate({ params: s.idParams, body: s.labStatusBody }),
  asyncHandler(async (req, res) => {
    const doc = await loadLab(req.auth!, params(req, s.idParams).id);
    const b = body(req, s.labStatusBody);
    if (!LAB_FLOW[doc.status]!.includes(b.to)) throw ApiError.conflict('INVALID_STATE_TRANSITION', `Cannot go from ${doc.status} to ${b.to}`);
    if (b.to === 'remake' && !b.reason) throw ApiError.validation([{ path: 'reason', code: 'required' }]);
    const now = new Date();
    doc.statusHistory.push({ from: doc.status, to: b.to, at: now, ...(b.reason ? { reason: b.reason } : {}) });
    doc.status = b.to;
    if (b.to === 'sent') doc.sentAt = now;
    if (b.to === 'received') {
      doc.receivedAt = now;
      if (b.cost !== undefined) doc.cost = b.cost;
    }
    if (b.to === 'fitted') doc.fittedAt = now;
    await doc.save();
    if (b.to === 'received' && doc.cost && doc.labSupplierId) {
      // Lab cost per case shows in profitability: received with a cost → supplier bill draft (07 §8).
      const { labBillDraft } = await import('@/modules/billing/billing.routes');
      await labBillDraft(req.auth!, String(doc._id));
    }
    await recordAudit({ action: 'status_change', entity: 'labOrder', entityId: doc._id, after: { status: b.to } });
    ok(res, labDto(doc.toObject() as never));
  }),
);

/* ---------- consents (07 §10) ---------- */

clinicalRouter.use(
  crudRouter({
    path: '/consent-templates',
    entity: 'consentTemplate',
    tag: 'clinical',
    model: ConsentTemplateModel as never,
    perms: { read: ['clinical.consent.manage', 'clinical.chart.read'], create: 'clinical.consent.manage' },
    createSchema: s.consentTemplateBody,
    updateSchema: updateOf(s.consentTemplateBody.shape),
    sortable: ['title', 'createdAt'],
    defaultSort: { title: 1 },
    searchFrom: (b) => b.title as string,
    unpaged: true,
  }),
);

const consentDto = (c: Record<string, unknown> & { _id: Types.ObjectId }) => ({ ...defaultDto(c as never), patientId: String(c.patientId), templateId: id(c.templateId), signatureFileId: id(c.signatureFileId), witnessStaffId: id(c.witnessStaffId), appointmentId: id(c.appointmentId) });

clinicalRouter.get(
  '/patients/:patientId/consents',
  authorize('clinical.chart.read', 'clinical.consent.manage'),
  validate({ params: s.patientParams }),
  asyncHandler(async (req, res) => {
    const p = await patientOf(req, params(req, s.patientParams).patientId);
    const rows = await ConsentModel.find({ patientId: p._id }).sort({ signedAt: -1 }).limit(100).lean();
    ok(res, rows.map((r) => consentDto(r as never)));
  }),
);

/** Renders placeholders then freezes the text with the signature (07 §10). */
clinicalRouter.post(
  '/consents',
  authorize('clinical.chart.update', 'clinical.consent.manage'),
  validate({ body: s.consentBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.consentBody);
    const p = await patientOf(req, b.patientId);
    const tpl = await ConsentTemplateModel.findById(b.templateId).lean();
    if (!tpl || !tpl.isActive) throw ApiError.validation([{ path: 'templateId', code: 'not_found' }]);
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name timezone').lean());
    const vars: Record<string, string> = { 'patient.name': p.fullName ?? '', 'patient.file': p.fileNumber ?? '', date: localDate(new Date(), clinic?.timezone ?? 'Asia/Amman'), clinic: clinic?.name ?? '', ...b.values };
    const rendered = tpl.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(b.signature);
    if (!m) throw ApiError.validation([{ path: 'signature', code: 'required' }]);
    const file = await saveFile({ clinicId: String(currentClinicId()), ownerType: 'patient', ownerId: p._id, buffer: Buffer.from(m[1]!, 'base64'), originalName: `consent-${tpl.title}.png`, category: 'consent', userId: req.auth!.userId });
    const doc = await ConsentModel.create({ patientId: p._id, templateId: tpl._id, title: tpl.title, renderedBody: rendered, procedureCategories: tpl.procedureCategories, signedAt: new Date(), signerName: b.signerName, signatureFileId: file._id, witnessStaffId: b.witnessStaffId ?? req.auth!.staffId, appointmentId: b.appointmentId });
    await recordAudit({ action: 'create', entity: 'consent', entityId: doc._id, after: { patientId: String(p._id), template: tpl.title } });
    created(res, consentDto(doc.toObject() as never));
  }),
);

/* ---------- cross-module hooks ---------- */

registerOwnPatientSource(async (staffId) => {
  const [a, b] = await Promise.all([PerformedProcedureModel.distinct('patientId', { dentistId: staffId }), TreatmentPlanModel.distinct('patientId', { dentistId: staffId })]);
  return [...a, ...b] as Types.ObjectId[];
});

registerCompletionCheck(async (appointmentId) => PerformedProcedureModel.countDocuments({ appointmentId, status: 'completed' }));

registerTimelineSource(async (patientId) => {
  const [procs, plans] = await Promise.all([
    PerformedProcedureModel.find({ patientId }).sort({ performedAt: -1 }).limit(50).select('code toothNumbers performedAt status').lean(),
    TreatmentPlanModel.find({ patientId }).sort({ createdAt: -1 }).limit(20).select('number status createdAt').lean(),
  ]);
  return [
    ...procs.map((p) => ({ at: p.performedAt, kind: `procedure.${p.status}`, title: `${p.code}${p.toothNumbers.length ? ` · ${p.toothNumbers.join(', ')}` : ''}` })),
    ...plans.map((p) => ({ at: (p as { createdAt?: Date }).createdAt ?? new Date(), kind: `plan.${p.status}`, title: p.number })),
  ];
});

// Recall rules from the procedure (07 §7 / 06 §7): e.g. prophylaxis → cleaning in 6 months.
on('procedure.completed', async ({ clinicId, procedureId, patientId }) => {
  await runInTenant(clinicId, async () => {
    const proc = await PerformedProcedureModel.findById(procedureId).select('clinicProcedureId performedAt').lean();
    const cp = proc ? await ClinicProcedureModel.findById(proc.clinicProcedureId).select('recall').lean() : null;
    if (!proc || !cp?.recall?.type || !cp.recall.months) return;
    const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('timezone').lean());
    const base = localDate(proc.performedAt, clinic?.timezone ?? 'Asia/Amman');
    const due = addDays(base, Math.round(cp.recall.months * 30.4));
    await upsertRecall(patientId, cp.recall.type as 'cleaning', due, cp.recall.months);
  });
});

// Booking with plan items marks them scheduled (06 §3 / 07 §3).
on('appointment.booked', async ({ clinicId, appointmentId }) => {
  await runInTenant(clinicId, async () => {
    const appt = await AppointmentModel.findById(appointmentId).select('plannedItems').lean();
    const ids = (appt?.plannedItems ?? []).map((i) => i.treatmentPlanItemId).filter(Boolean).map(String);
    await tx.markItemsScheduled(ids, appointmentId);
  });
});

registerPath({ method: 'post', path: '/treatment-plans', tags: ['clinical'], summary: 'Create a treatment plan (priced + insurance estimate)', body: s.planBody });
registerPath({ method: 'post', path: '/performed-procedures', tags: ['clinical'], summary: 'Record a performed procedure (chart + plan + events)', body: s.performBody });
registerPath({ method: 'post', path: '/notes', tags: ['clinical'], summary: 'Clinical note (sign / amend afterwards)', body: s.noteBody.innerType() });
