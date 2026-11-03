import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import { crudRouter, defaultDto, updateOf } from '@/core/crud/crudRouter';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { body, query, validate } from '@/core/validation/validate';
import { ProcedureCatalogModel, MedicineModel, ToothConditionModel } from '@/modules/catalog/catalog.models';
import { PROCEDURE_CATEGORIES } from '@/modules/catalog/procedureCatalog.seed';
import { ClinicModel, isClinicReadOnly } from '@/modules/platform/clinic.model';
import { encrypt } from '@/shared/crypto';
import {
  basisPoints,
  color,
  email,
  entityName,
  enumOf,
  freeText,
  money,
  nullable,
  objectId,
  optional,
  phone,
  taxNumber,
  timeOfDay,
} from '@/shared/validation/fields';
import { escapeRegex, toSearchName } from '@/shared/validation/normalize';
import { AppointmentTypeModel, ChairModel, ClinicProcedureModel, TaxRateModel } from './clinic.models';

export const clinicRouter = Router();

/* ---------- clinic profile, hours, settings ---------- */

const workingHoursSchema = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), open: timeOfDay(), close: timeOfDay(), closed: z.boolean() }))
  .length(7)
  .superRefine((days, ctx) => {
    days.forEach((d, i) => {
      if (!d.closed && d.close <= d.open) ctx.addIssue({ code: 'custom', path: [i, 'close'], message: 'end_before_start' });
    });
  });

const settingsSchema = z
  .object({
    cancellationWindowHours: z.number().int().min(0).max(168),
    noShowGraceMinutes: z.number().int().min(0).max(240),
    onlineBookingEnabled: z.boolean(),
    minOnlineLeadHours: z.number().int().min(0).max(168),
    maxOnlineDaysAhead: z.number().int().min(1).max(365),
    defaultAppointmentMinutes: z.number().int().min(5).max(480),
    vatRegistered: z.boolean(),
    invoiceFooter: freeText(500),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    maxDiscountPercentWithoutApproval: z.number().min(0).max(100),
    printLanguage: enumOf(['ar', 'en']),
    weekendDays: z.array(z.number().int().min(0).max(6)).max(3),
    consentMode: enumOf(['off', 'warn', 'strict']),
  })
  .partial()
  .strict();

const clinicPatch = z
  .object({
    version: z.number().int().min(0),
    name: entityName().optional(),
    phone: nullable(phone()),
    email: nullable(email()),
    addressLine1: optional(freeText(200)),
    taxNumber: nullable(taxNumber()),
    commercialRegNo: optional(freeText(40)),
    timezone: z.string().max(60).optional(),
    locale: enumOf(['ar', 'en']).optional(),
    workingHours: workingHoursSchema.optional(),
    settings: settingsSchema.optional(),
  })
  .strict();

function clinicDto(c: Awaited<ReturnType<typeof loadClinic>>) {
  return {
    id: String(c._id),
    version: c.__v ?? 0,
    name: c.name,
    slug: c.slug,
    phone: c.phone?.e164,
    email: c.email,
    addressLine1: c.address?.line1 ?? '',
    taxNumber: c.taxNumber,
    commercialRegNo: c.commercialRegNo,
    timezone: c.timezone,
    currency: c.currency,
    locale: c.locale,
    workingHours: c.workingHours,
    settings: c.settings,
    integrations: {
      jofotara: {
        enabled: Boolean(c.integrations?.jofotara?.enabled),
        clientId: c.integrations?.jofotara?.clientId ?? '',
        activityNumber: c.integrations?.jofotara?.activityNumber ?? '',
        incomeSourceSequence: c.integrations?.jofotara?.incomeSourceSequence ?? '',
        hasSecret: Boolean(c.integrations?.jofotara?.secretKeyEnc),
      },
      whatsapp: { enabled: Boolean(c.integrations?.whatsapp?.enabled) },
    },
    subscription: c.subscription,
    status: c.status,
    readOnly: isClinicReadOnly(c),
    onboarding: c.onboarding,
  };
}

async function loadClinic(id: string) {
  const c = await runWithoutTenant(() => ClinicModel.findById(id).select('+integrations.jofotara.secretKeyEnc').lean());
  if (!c) throw ApiError.notFound();
  return c;
}

clinicRouter.get('/clinic', authorize('clinic.settings.read'), asyncHandler(async (req, res) => ok(res, clinicDto(await loadClinic(req.auth!.clinicId!)))));

clinicRouter.patch(
  '/clinic',
  authorize('clinic.settings.update'),
  validate({ body: clinicPatch }),
  asyncHandler(async (req, res) => {
    const b = body(req, clinicPatch);
    const doc = await runWithoutTenant(() => ClinicModel.findById(req.auth!.clinicId));
    if (!doc) throw ApiError.notFound();
    if ((doc.__v ?? 0) !== b.version) throw ApiError.conflict('VERSION_CONFLICT', 'The clinic was changed by someone else.');
    const before = doc.toObject();
    if (b.name) {
      doc.name = b.name;
      doc.searchName = toSearchName(b.name);
    }
    if (b.phone !== undefined) doc.set('phone', b.phone ? { e164: b.phone } : undefined);
    if (b.email !== undefined) doc.set('email', b.email ?? undefined);
    if (b.addressLine1 !== undefined) doc.set('address.line1', b.addressLine1);
    if (b.taxNumber !== undefined) doc.set('taxNumber', b.taxNumber ?? undefined);
    if (b.commercialRegNo !== undefined) doc.set('commercialRegNo', b.commercialRegNo);
    if (b.timezone) doc.timezone = b.timezone;
    if (b.locale) doc.locale = b.locale;
    if (b.workingHours) doc.set('workingHours', [...b.workingHours].sort((x, y) => x.weekday - y.weekday));
    if (b.settings) for (const [k, v] of Object.entries(b.settings)) doc.set(`settings.${k}`, v);
    doc.increment();
    await doc.save();
    await recordAudit({ action: 'update', entity: 'clinic', entityId: doc._id, before, after: doc.toObject() });
    ok(res, clinicDto(await loadClinic(String(doc._id))));
  }),
);

const onboardingBody = z.object({ step: enumOf(['profile', 'hours', 'chairs', 'dentists', 'procedures', 'done']) }).strict();
clinicRouter.post(
  '/clinic/onboarding',
  authorize('clinic.settings.update'),
  validate({ body: onboardingBody }),
  asyncHandler(async (req, res) => {
    const { step } = body(req, onboardingBody);
    await runWithoutTenant(() =>
      ClinicModel.updateOne(
        { _id: req.auth!.clinicId },
        { $addToSet: { 'onboarding.completedSteps': step }, ...(step === 'done' ? { $set: { 'onboarding.completedAt': new Date() } } : {}) },
      ),
    );
    ok(res, clinicDto(await loadClinic(req.auth!.clinicId!)));
  }),
);

const jofotaraBody = z
  .object({
    enabled: z.boolean(),
    clientId: optional(z.string().trim().max(120)),
    secretKey: optional(z.string().trim().min(8, { message: 'too_short' }).max(500)),
    activityNumber: optional(z.string().trim().max(40)),
    incomeSourceSequence: optional(z.string().trim().max(40)),
  })
  .strict();

/** JoFotara credentials are write-only: the secret is encrypted and never returned (11 §8). */
clinicRouter.put(
  '/clinic/integrations/jofotara',
  authorize('clinic.settings.update'),
  validate({ body: jofotaraBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, jofotaraBody);
    const set: Record<string, unknown> = {
      'integrations.jofotara.enabled': b.enabled,
      'integrations.jofotara.clientId': b.clientId ?? '',
      'integrations.jofotara.activityNumber': b.activityNumber ?? '',
      'integrations.jofotara.incomeSourceSequence': b.incomeSourceSequence ?? '',
    };
    if (b.secretKey) set['integrations.jofotara.secretKeyEnc'] = encrypt(b.secretKey);
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: req.auth!.clinicId }, { $set: set }));
    await recordAudit({ action: 'update', entity: 'clinic', entityId: req.auth!.clinicId, summary: 'jofotara_credentials', after: { enabled: b.enabled, clientId: b.clientId, secretChanged: Boolean(b.secretKey) } });
    ok(res, clinicDto(await loadClinic(req.auth!.clinicId!)).integrations);
  }),
);

/* ---------- chairs ---------- */

const chairShape = { name: entityName({ max: 60 }), roomName: optional(freeText(60)), color: color(), isActive: z.boolean().default(true), sortOrder: z.number().int().min(0).max(999).default(0) };
clinicRouter.use(
  crudRouter({
    path: '/chairs',
    entity: 'chair',
    tag: 'clinic',
    model: ChairModel as never,
    perms: { read: ['clinic.chair.manage', 'scheduling.appointment.read', 'clinic.settings.read'], create: 'clinic.chair.manage' },
    createSchema: z.object(chairShape).strict(),
    updateSchema: updateOf(chairShape),
    sortable: ['sortOrder', 'name', 'createdAt'],
    defaultSort: { sortOrder: 1, name: 1 },
    searchFrom: (b) => b.name as string | undefined,
    buildFilter: (q) => (q.includeInactive === 'true' ? {} : { isActive: true }),
    unpaged: true,
  }),
);

/* ---------- appointment types ---------- */

const apptTypeShape = {
  name: entityName({ max: 80 }),
  code: optional(z.string().trim().max(12)),
  defaultDurationMin: z.number().int().min(5).max(480),
  color: color(),
  bufferAfterMin: z.number().int().min(0).max(120).default(0),
  allowOnline: z.boolean().default(false),
  requiresDeposit: z.boolean().default(false),
  defaultProcedureIds: z.array(objectId()).max(20).default([]),
  isActive: z.boolean().default(true),
};
clinicRouter.use(
  crudRouter({
    path: '/appointment-types',
    entity: 'appointmentType',
    tag: 'clinic',
    model: AppointmentTypeModel as never,
    perms: { read: ['clinic.appointmentType.manage', 'scheduling.appointment.read', 'clinic.settings.read'], create: 'clinic.appointmentType.manage' },
    createSchema: z.object(apptTypeShape).strict(),
    updateSchema: updateOf({ ...apptTypeShape, name: nullable(entityName({ max: 80 })) }),
    sortable: ['name', 'defaultDurationMin', 'createdAt'],
    defaultSort: { createdAt: 1 },
    searchFrom: (b) => (b.name as string | undefined) ?? (b.systemKey as string | undefined),
    buildFilter: (q) => (q.includeInactive === 'true' ? {} : { isActive: true }),
    unpaged: true,
  }),
);

/* ---------- tax rates ---------- */

const taxShape = {
  name: entityName({ max: 60 }),
  rate: basisPoints(),
  jofotaraCategory: enumOf(['S', 'Z', 'O']),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
};
async function singleDefault(doc: Record<string, unknown>) {
  if (doc.isDefault) await TaxRateModel.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
}
clinicRouter.use(
  crudRouter({
    path: '/tax-rates',
    entity: 'taxRate',
    tag: 'clinic',
    model: TaxRateModel as never,
    perms: { read: ['accounting.account.read', 'clinic.procedure.manage', 'billing.invoice.read', 'clinic.settings.read'], create: 'accounting.account.manage' },
    createSchema: z.object(taxShape).strict(),
    updateSchema: updateOf({ ...taxShape, name: nullable(entityName({ max: 60 })) }),
    sortable: ['rate', 'createdAt'],
    defaultSort: { rate: 1 },
    unpaged: true,
    afterWrite: async (doc, _a, kind) => {
      if (kind !== 'delete') await singleDefault(doc);
    },
  }),
);

/* ---------- clinic procedures ---------- */

const procShape = {
  code: z.string().trim().min(1, { message: 'required' }).max(16, { message: 'too_long' }),
  name: entityName({ max: 120 }),
  category: enumOf([...PROCEDURE_CATEGORIES]),
  price: money(),
  taxRateId: nullable(objectId()),
  defaultDurationMin: z.number().int().min(5).max(480).default(30),
  toothRequired: z.boolean().default(false),
  surfacesRequired: z.boolean().default(false),
  labRequired: z.boolean().default(false),
  commissionEligible: z.boolean().default(true),
  insurancePrices: z.array(z.object({ insuranceCompanyId: objectId(), price: money() })).max(50).default([]),
  isActive: z.boolean().default(true),
};
clinicRouter.use(
  crudRouter({
    path: '/procedures',
    entity: 'clinicProcedure',
    tag: 'clinic',
    model: ClinicProcedureModel as never,
    perms: {
      read: ['clinic.procedure.manage', 'clinical.treatmentPlan.read', 'billing.invoice.read', 'clinical.procedure.perform', 'clinic.settings.read', 'scheduling.appointment.read'],
      create: 'clinic.procedure.manage',
    },
    createSchema: z.object(procShape).strict(),
    updateSchema: updateOf({ ...procShape, name: nullable(entityName({ max: 120 })) }),
    filters: { category: z.enum(PROCEDURE_CATEGORIES).optional() },
    buildFilter: (q) => ({ ...(q.includeInactive === 'true' ? {} : { isActive: true }), ...(q.category ? { category: q.category } : {}) }),
    sortable: ['code', 'price', 'category', 'createdAt'],
    defaultSort: { code: 1 },
    searchFrom: (b) => [b.code, b.name ?? b.systemKey].filter(Boolean).join(' '),
  }),
);

const importBody = z.object({ codes: z.array(z.string().max(16)).min(1, { message: 'too_few' }).max(200), priceFactorPercent: z.number().min(10).max(500).default(100) }).strict();

/** Import from the global catalog (onboarding step "procedures & prices"). Skips existing codes. */
clinicRouter.post(
  '/procedures/import-from-catalog',
  authorize('clinic.procedure.manage'),
  validate({ body: importBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, importBody);
    const catalog = await ProcedureCatalogModel.find({ code: { $in: b.codes }, isActive: true }).lean();
    const existing = new Set((await ClinicProcedureModel.find({ code: { $in: b.codes } }).select('code').lean()).map((p) => p.code));
    const defaultTax = await TaxRateModel.findOne({ isDefault: true }).select('_id').lean();
    const docs = catalog
      .filter((c) => !existing.has(c.code))
      .map((c) => ({
        catalogId: c._id,
        code: c.code,
        name: c.name,
        systemKey: c.code,
        searchName: toSearchName(c.code),
        category: c.category,
        price: Math.round(((c.suggestedPrice ?? 0) * b.priceFactorPercent) / 100 / 10) * 10,
        taxRateId: defaultTax?._id,
        defaultDurationMin: c.defaultDurationMin,
        toothRequired: c.toothRequired,
        surfacesRequired: c.surfacesRequired,
        labRequired: c.labRequired,
        chartEffect: c.chartEffect,
        recall: c.recall,
      }));
    if (docs.length) await ClinicProcedureModel.insertMany(docs);
    await recordAudit({ action: 'create', entity: 'clinicProcedure', summary: `imported ${docs.length} from catalog` });
    ok(res, { imported: docs.length, skipped: b.codes.length - docs.length });
  }),
);

/* ---------- global catalogs (read for clinics) ---------- */

const catalogQuery = z.object({ q: z.string().trim().max(60).optional(), category: z.enum(PROCEDURE_CATEGORIES).optional() }).strict();
clinicRouter.get(
  '/catalog/procedures',
  authorize('clinic.procedure.manage', 'clinic.settings.read'),
  validate({ query: catalogQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, catalogQuery);
    const items = await ProcedureCatalogModel.find({ isActive: true, ...(q.category ? { category: q.category } : {}) }).sort({ code: 1 }).lean();
    ok(res, items.map((i) => defaultDto(i as never)));
  }),
);

clinicRouter.get(
  '/catalog/tooth-conditions',
  authorize('clinical.chart.read', 'clinic.settings.read'),
  asyncHandler(async (_req, res) => ok(res, (await ToothConditionModel.find({ isActive: true }).lean()).map((i) => defaultDto(i as never)))),
);

const medQuery = z.object({ q: z.string().trim().max(60).optional() }).strict();
clinicRouter.get(
  '/catalog/medicines',
  authorize('clinical.prescription.write', 'clinical.prescription.read', 'patients.medicalHistory.update'),
  validate({ query: medQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, medQuery);
    const filter = q.q ? { searchName: { $regex: escapeRegex(toSearchName(q.q)) } } : {};
    ok(res, (await MedicineModel.find(filter).sort({ name: 1 }).limit(50).lean()).map((i) => defaultDto(i as never)));
  }),
);

registerPath({ method: 'get', path: '/clinic', tags: ['clinic'], summary: 'Clinic profile, hours and settings' });
registerPath({ method: 'patch', path: '/clinic', tags: ['clinic'], summary: 'Update clinic profile, hours and settings', body: clinicPatch });
registerPath({ method: 'put', path: '/clinic/integrations/jofotara', tags: ['clinic'], summary: 'JoFotara credentials (write-only secret)', body: jofotaraBody });
registerPath({ method: 'post', path: '/procedures/import-from-catalog', tags: ['clinic'], summary: 'Import procedures from the global catalog', body: importBody });
