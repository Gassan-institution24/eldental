import { Router } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import type { AuthContext } from '@/core/auth/auth.types';
import { crudRouter, defaultDto, updateOf } from '@/core/crud/crudRouter';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, noContent, ok } from '@/core/http/response';
import { exportRateLimit } from '@/core/http/security';
import { registerPath } from '@/core/openapi/registry';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { FileAssetModel, saveFile, storage } from '@/core/storage/storage';
import { body, params, query, validate } from '@/core/validation/validate';
import { toCsv } from '@/shared/csv';
import { dateOnly, entityName, freeText, optional, percent, phone, email } from '@/shared/validation/fields';
import { InsuranceCompanyModel, InsurancePolicyModel, MedicalHistoryModel } from './patient.models';
import * as s from './patient.schemas';
import * as svc from './patient.service';

export const patientRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

patientRouter.get(
  '/patients/search',
  authorize('patients.patient.read'),
  validate({ query: s.searchQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, s.searchQuery);
    ok(res, await svc.searchPatients(req.auth!, q.q, q.limit));
  }),
);

patientRouter.get(
  '/patients/check-duplicate',
  authorize('patients.patient.create', 'patients.patient.update'),
  validate({ query: s.duplicateQuery }),
  asyncHandler(async (req, res) => ok(res, await svc.findDuplicates(req.auth!, query(req, s.duplicateQuery)))),
);

patientRouter.get(
  '/patients/export',
  authorize('patients.patient.export'),
  exportRateLimit,
  validate({ query: s.patientListQuery }),
  asyncHandler(async (req, res) => {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const r = await svc.listPatients(req.auth!, { ...query(req, s.patientListQuery), page, limit: 100 });
      rows.push(...(r.data as Record<string, unknown>[]));
      if (page >= r.meta.pages) break;
    }
    await recordAudit({ action: 'export', entity: 'patient', summary: `${rows.length} rows` });
    const cols = ['fileNumber', 'fullName', 'gender', 'dateOfBirth', 'phone', 'email', 'nationalId', 'balance', 'status'].filter((c) => rows.some((r) => r[c] !== undefined));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="patients.csv"');
    res.send(toCsv(cols, rows));
  }),
);

patientRouter.get(
  '/patients',
  authorize('patients.patient.read'),
  validate({ query: s.patientListQuery }),
  asyncHandler(async (req, res) => {
    const r = await svc.listPatients(req.auth!, query(req, s.patientListQuery));
    ok(res, r.data, r.meta);
  }),
);

patientRouter.get('/patients/:id', authorize('patients.patient.read'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.getPatient(req.auth!, params(req, s.idParams).id))));

patientRouter.post(
  '/patients',
  authorize('patients.patient.create'),
  validate({ body: s.patientCreateBody }),
  asyncHandler(async (req, res) => {
    const p = await svc.createPatient(req.auth!, body(req, s.patientCreateBody));
    created(res, p, `/patients/${p.id}`);
  }),
);

patientRouter.patch(
  '/patients/:id',
  authorize('patients.patient.update'),
  validate({ params: s.idParams, body: s.patientUpdateBody }),
  asyncHandler(async (req, res) => ok(res, await svc.updatePatient(req.auth!, params(req, s.idParams).id, body(req, s.patientUpdateBody)))),
);

patientRouter.delete(
  '/patients/:id',
  authorize('patients.patient.delete'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    await svc.deletePatient(req.auth!, params(req, s.idParams).id);
    noContent(res);
  }),
);

patientRouter.post(
  '/patients/:id/restore',
  authorize('patients.patient.delete'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    await svc.restorePatient(params(req, s.idParams).id);
    noContent(res);
  }),
);

patientRouter.post(
  '/patients/:id/merge',
  authorize('patients.patient.delete'),
  validate({ params: s.idParams, body: s.mergeBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.mergeBody);
    ok(res, await svc.mergePatients(req.auth!, params(req, s.idParams).id, b.sourceId, b.reason ?? ''));
  }),
);

/* ---------- photo, ID verification, referrals ---------- */

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
patientRouter.put(
  '/patients/:id/photo',
  authorize('patients.patient.update'),
  imageUpload.single('file'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.validation([{ path: 'file', code: 'required' }]);
    ok(res, await svc.setPhoto(req.auth!, params(req, s.idParams).id, req.file));
  }),
);
patientRouter.delete('/patients/:id/photo', authorize('patients.patient.update'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.removePhoto(req.auth!, params(req, s.idParams).id))));
patientRouter.post('/patients/:id/verify-id', authorize('patients.patient.update'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.verifyId(req.auth!, params(req, s.idParams).id))));
patientRouter.get('/patients/:id/referrals', authorize('patients.patient.read'), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.referralsOf(req.auth!, params(req, s.idParams).id))));

const rangeQuery = z.object({ from: dateOnly(), to: dateOnly() }).strict();
patientRouter.get(
  '/reports/referrals',
  // Patient scope applies: a dentist with own scope only counts their own patients.
  authorize('patients.patient.read'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, rangeQuery);
    ok(res, await svc.referralReport(req.auth!, q.from, q.to));
  }),
);

/* ---------- medical history (versioned) ---------- */

function historyDto(h: Record<string, unknown> & { _id: Types.ObjectId }) {
  return { ...defaultDto(h as never), version: h.version, conditions: ((h.answers as { conditions?: string[] }) ?? {}).conditions ?? [] };
}

patientRouter.get(
  '/patients/:id/medical-history',
  authorize('patients.medicalHistory.read'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const h = await MedicalHistoryModel.findOne({ patientId: p._id }).sort({ version: -1 }).lean();
    ok(res, h ? historyDto(h as never) : null);
  }),
);

patientRouter.get(
  '/patients/:id/medical-history/versions',
  authorize('patients.medicalHistory.read'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const items = await MedicalHistoryModel.find({ patientId: p._id }).sort({ version: -1 }).limit(50).lean();
    ok(res, items.map((h) => historyDto(h as never)));
  }),
);

/** New version on every update; alerts are denormalised onto the patient (07 §11). */
patientRouter.post(
  '/patients/:id/medical-history',
  authorize('patients.medicalHistory.update'),
  validate({ params: s.idParams, body: s.medicalHistoryBody }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const b = body(req, s.medicalHistoryBody);
    const last = await MedicalHistoryModel.findOne({ patientId: p._id }).sort({ version: -1 }).select('version').lean();
    const h = await MedicalHistoryModel.create({
      patientId: p._id,
      version: (last?.version ?? 0) + 1,
      answers: { conditions: b.conditions },
      medications: b.medications ?? '',
      allergies: b.allergies,
      notes: b.notes ?? '',
      ...(b.reviewed ? { reviewedBy: req.auth!.staffId, reviewedAt: new Date() } : {}),
    });
    const alerts = [...b.conditions.filter((c) => s.ALERT_CONDITIONS.has(c)).map((c) => `condition:${c}`), ...b.allergies.map((a) => `allergy:${a.substance}`)];
    p.medicalAlerts = alerts.slice(0, 20);
    await p.save();
    await recordAudit({ action: 'create', entity: 'medicalHistory', entityId: h._id, summary: `version ${h.version}`, after: { patientId: String(p._id), conditions: b.conditions.length, allergies: b.allergies.length } });
    created(res, historyDto(h.toObject() as never));
  }),
);

/* ---------- insurance policies ---------- */

async function policyDto(p: Record<string, unknown> & { _id: Types.ObjectId; insuranceCompanyId?: Types.ObjectId }) {
  const company = p.insuranceCompanyId ? await InsuranceCompanyModel.findById(p.insuranceCompanyId).select('name').lean() : null;
  return { ...defaultDto(p as never), insuranceCompanyId: String(p.insuranceCompanyId), insuranceCompanyName: company?.name ?? '' };
}

patientRouter.get(
  '/patients/:id/insurance-policies',
  authorize('patients.patient.read'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const items = await InsurancePolicyModel.find({ patientId: p._id }).sort({ isPrimary: -1, createdAt: -1 }).lean();
    ok(res, await Promise.all(items.map((i) => policyDto(i as never))));
  }),
);

patientRouter.post(
  '/patients/:id/insurance-policies',
  authorize('patients.patient.update', 'billing.insurance.manage'),
  validate({ params: s.idParams, body: s.policyBody }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const b = body(req, s.policyBody);
    if (!(await InsuranceCompanyModel.exists({ _id: b.insuranceCompanyId, isActive: true }))) throw ApiError.validation([{ path: 'insuranceCompanyId', code: 'not_found' }]);
    if (b.isPrimary) await InsurancePolicyModel.updateMany({ patientId: p._id }, { $set: { isPrimary: false } });
    const pol = await InsurancePolicyModel.create({ ...b, patientId: p._id });
    await recordAudit({ action: 'create', entity: 'insurancePolicy', entityId: pol._id, after: pol.toObject() });
    created(res, await policyDto(pol.toObject() as never));
  }),
);

patientRouter.patch(
  '/patients/:id/insurance-policies/:policyId',
  authorize('patients.patient.update', 'billing.insurance.manage'),
  validate({ params: s.policyParams, body: s.policyBody }),
  asyncHandler(async (req, res) => {
    const pr = params(req, s.policyParams);
    const p = await svc.loadScopedPatient(req.auth!, pr.id);
    const pol = await InsurancePolicyModel.findOne({ _id: pr.policyId, patientId: p._id });
    if (!pol) throw ApiError.notFound();
    const b = body(req, s.policyBody);
    if (b.isPrimary) await InsurancePolicyModel.updateMany({ patientId: p._id, _id: { $ne: pol._id } }, { $set: { isPrimary: false } });
    const before = pol.toObject();
    pol.set(b);
    await pol.save();
    await recordAudit({ action: 'update', entity: 'insurancePolicy', entityId: pol._id, before, after: pol.toObject() });
    ok(res, await policyDto(pol.toObject() as never));
  }),
);

patientRouter.delete(
  '/patients/:id/insurance-policies/:policyId',
  authorize('patients.patient.update', 'billing.insurance.manage'),
  validate({ params: s.policyParams }),
  asyncHandler(async (req, res) => {
    const pr = params(req, s.policyParams);
    const p = await svc.loadScopedPatient(req.auth!, pr.id);
    const pol = await InsurancePolicyModel.findOne({ _id: pr.policyId, patientId: p._id });
    if (!pol) throw ApiError.notFound();
    await (pol as unknown as { softDelete: () => Promise<void> }).softDelete();
    await recordAudit({ action: 'delete', entity: 'insurancePolicy', entityId: pol._id });
    noContent(res);
  }),
);

/* ---------- documents & imaging ---------- */

function fileDto(f: Record<string, unknown> & { _id: Types.ObjectId }) {
  const { storageKey: _k, sha256: _h, ...rest } = defaultDto(f as never);
  return { ...rest, url: `${env.API_PREFIX}/files/${String(f._id)}` };
}

const listFilesQuery = z.object({ category: z.enum(['xray', 'photo', 'document', 'consent', 'id', 'other']).optional() }).strict();
patientRouter.get(
  '/patients/:id/documents',
  authorize('patients.document.read', 'clinical.imaging.read'),
  validate({ params: s.idParams, query: listFilesQuery }),
  asyncHandler(async (req, res) => {
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const q = query(req, listFilesQuery);
    const items = await FileAssetModel.find({ ownerType: 'patient', ownerId: p._id, ...(q.category ? { category: q.category } : {}) }).sort({ createdAt: -1 }).limit(200).lean();
    ok(res, items.map((f) => fileDto(f as never)));
  }),
);

patientRouter.post(
  '/patients/:id/documents',
  authorize('patients.document.upload', 'clinical.imaging.upload'),
  upload.single('file'),
  validate({ params: s.idParams, body: s.uploadMeta }),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.validation([{ path: 'file', code: 'required' }]);
    const p = await svc.loadScopedPatient(req.auth!, params(req, s.idParams).id);
    const meta = body(req, s.uploadMeta);
    const f = await saveFile({
      clinicId: req.auth!.clinicId!,
      ownerType: 'patient',
      ownerId: p._id,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      category: meta.category,
      userId: req.auth!.userId,
      notes: meta.notes,
      toothNumbers: meta.toothNumbers ? meta.toothNumbers.split(',').map(Number) : undefined,
      takenAt: meta.takenAt ? new Date(meta.takenAt) : undefined,
    });
    await recordAudit({ action: 'create', entity: 'file', entityId: f._id, after: { patientId: String(p._id), category: f.category, mime: f.mime, size: f.size } });
    created(res, fileDto(f.toObject() as never));
  }),
);

patientRouter.delete(
  '/patients/:id/documents/:fileId',
  authorize('patients.document.delete'),
  validate({ params: s.fileParams }),
  asyncHandler(async (req, res) => {
    const pr = params(req, s.fileParams);
    const p = await svc.loadScopedPatient(req.auth!, pr.id);
    const f = await FileAssetModel.findOne({ _id: pr.fileId, ownerType: 'patient', ownerId: p._id });
    if (!f) throw ApiError.notFound();
    await (f as unknown as { softDelete: () => Promise<void> }).softDelete();
    await recordAudit({ action: 'delete', entity: 'file', entityId: f._id });
    noContent(res);
  }),
);

/** Authorised download: re-checks the owner and the caller's rights (11 §6). Never public. */
const OWNER_PERMS: Record<string, string[]> = {
  patient: ['patients.document.read', 'clinical.imaging.read', 'clinical.chart.read'],
  staff: ['staff.member.read'],
  clinic: ['clinic.settings.read'],
  labOrder: ['clinical.labOrder.read'],
  consent: ['clinical.consent.manage', 'patients.document.read'],
  expense: ['accounting.expense.create', 'accounting.expense.approve'],
  plan: ['clinical.treatmentPlan.read'],
  issue: ['logs.issues.read'],
};
patientRouter.get(
  '/files/:id',
  authorize.self('staff'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const f = await FileAssetModel.findById(params(req, s.idParams).id).lean();
    if (!f) throw ApiError.notFound();
    const perms = [...(OWNER_PERMS[f.ownerType] ?? []), ...(f.ownerType === 'patient' && f.category === 'photo' ? ['patients.patient.read'] : [])];
    if (!perms.some((p) => scopeFor(req.auth!, p))) throw ApiError.notFound();
    if (f.ownerType === 'patient') await svc.loadScopedPatient({ ...req.auth!, scope: scopeFor(req.auth!, 'patients.patient.read') ?? 'own' }, String(f.ownerId));
    const data = await storage().get(f.storageKey);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.originalName || `file.${f.mime.split('/')[1]}`)}`);
    res.send(data);
  }),
);

/* ---------- timeline ---------- */

/**
 * Chronological history from the audit trail (+ modules add their own events). Each source
 * declares the permission it needs and applies its own scope, so the timeline never shows
 * what the caller couldn't open in its own tab (04 §1).
 */
export type TimelineEvent = { at: Date; kind: string; title: string; ref?: string };
type TimelineSource = { permissions: string[]; load: (patientId: Types.ObjectId, auth: AuthContext) => Promise<TimelineEvent[]> };
const timelineSources: TimelineSource[] = [];
export function registerTimelineSource(permissions: string | string[], load: TimelineSource['load']): void {
  timelineSources.push({ permissions: [permissions].flat(), load });
}

/** Audit entities shown on the timeline and the permission each one needs. */
const AUDIT_TIMELINE: Record<string, string[]> = {
  patient: ['patients.patient.read'],
  insurancePolicy: ['patients.patient.read'],
  medicalHistory: ['patients.medicalHistory.read'],
  file: ['patients.document.read', 'clinical.imaging.read'],
};
const allowed = (auth: AuthContext, perms: string[]) => perms.some((p) => scopeFor(auth, p));

patientRouter.get(
  '/patients/:id/timeline',
  authorize('patients.patient.read'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const p = await svc.loadScopedPatient(auth, params(req, s.idParams).id);
    const entities = Object.keys(AUDIT_TIMELINE).filter((e) => allowed(auth, AUDIT_TIMELINE[e]!));
    const audit = await AuditLogModel.find({ entity: { $in: entities }, $or: [{ entityId: String(p._id) }, { 'after.patientId': String(p._id) }] })
      .sort({ at: -1 })
      .limit(50)
      .lean();
    const sources = timelineSources.filter((src) => allowed(auth, src.permissions));
    const events = [
      ...audit.map((a) => ({ at: a.at, kind: `${a.entity}.${a.action}`, title: a.summary ?? '' })),
      ...(await Promise.all(sources.map((src) => src.load(p._id, auth)))).flat(),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    ok(res, events.slice(0, 100));
  }),
);

/* ---------- family (01 §4.3) ---------- */

patientRouter.get(
  '/patients/:id/family',
  authorize('patients.patient.read'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => ok(res, await svc.familyMembers(req.auth!, params(req, s.idParams).id))),
);

patientRouter.post(
  '/patients/:id/family',
  authorize('patients.patient.update'),
  validate({ params: s.idParams, body: s.familyLinkBody }),
  asyncHandler(async (req, res) => ok(res, await svc.linkFamily(req.auth!, params(req, s.idParams).id, body(req, s.familyLinkBody).patientId))),
);

patientRouter.delete(
  '/patients/:id/family',
  authorize('patients.patient.update'),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => {
    await svc.unlinkFamily(req.auth!, params(req, s.idParams).id);
    noContent(res);
  }),
);

/* ---------- insurance companies (basic, billing manages claims later) ---------- */

const companyShape = {
  name: entityName(),
  code: optional(z.string().trim().max(20)),
  contact: z.object({ phone: optional(phone()), email: optional(email()), person: optional(freeText(80)) }).strict().optional(),
  defaultCoveragePercent: percent(),
  coverageRules: z.array(z.object({ procedureCategory: z.string().max(30), percent: percent(), requiresPreApproval: z.boolean().default(false) })).max(20).default([]),
  isActive: z.boolean().default(true),
};
patientRouter.use(
  crudRouter({
    path: '/insurance-companies',
    entity: 'insuranceCompany',
    tag: 'billing',
    model: InsuranceCompanyModel as never,
    perms: { read: ['billing.insurance.manage', 'patients.patient.read', 'billing.invoice.read'], create: 'billing.insurance.manage' },
    createSchema: z.object(companyShape).strict(),
    updateSchema: updateOf(companyShape),
    sortable: ['name', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => b.name as string,
    buildFilter: (q) => (q.includeInactive === 'true' ? {} : { isActive: true }),
    unpaged: true,
  }),
);

registerPath({ method: 'get', path: '/patients', tags: ['patients'], summary: 'List patients (field rules + own scope)', query: s.patientListQuery });
registerPath({ method: 'post', path: '/patients', tags: ['patients'], summary: 'Register a patient', body: s.patientCreateBody });
registerPath({ method: 'get', path: '/patients/search', tags: ['patients'], summary: 'Typeahead', query: s.searchQuery });
registerPath({ method: 'post', path: '/patients/:id/merge', tags: ['patients'], summary: 'Merge a duplicate into this patient', params: s.idParams, body: s.mergeBody });
registerPath({ method: 'post', path: '/patients/:id/medical-history', tags: ['patients'], summary: 'New medical history version', params: s.idParams, body: s.medicalHistoryBody });
registerPath({ method: 'put', path: '/patients/:id/photo', tags: ['patients'], summary: 'Upload the profile photo (image, re-encoded)', params: s.idParams });
registerPath({ method: 'post', path: '/patients/:id/verify-id', tags: ['patients'], summary: 'Mark the ID verified (needs an id document)', params: s.idParams });
registerPath({ method: 'get', path: '/reports/referrals', tags: ['patients'], summary: 'Referrals report (own scope applies)', query: rangeQuery });
registerPath({ method: 'get', path: '/patients/:id/timeline', tags: ['patients'], summary: 'History (only events the caller may see)', params: s.idParams });
registerPath({ method: 'get', path: '/patients/:id/family', tags: ['patients'], summary: 'Family members (scoped)', params: s.idParams });
registerPath({ method: 'post', path: '/patients/:id/family', tags: ['patients'], summary: 'Link another patient into this family', params: s.idParams, body: s.familyLinkBody });
