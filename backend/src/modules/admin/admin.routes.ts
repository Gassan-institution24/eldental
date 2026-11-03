import { Router } from 'express';
import { z } from 'zod';
import type { AuthContext } from '@/core/auth/auth.types';
import { crudRouter, updateOf } from '@/core/crud/crudRouter';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok, pageMeta } from '@/core/http/response';
import { exportRateLimit } from '@/core/http/security';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { PLATFORM_PERMISSION_KEYS } from '@/core/rbac/platformRegistry';
import type { Grant } from '@/core/rbac/rbac.types';
import { body, params, query, validate } from '@/core/validation/validate';
import { CityModel, CountryModel, CurrencyModel, MedicineModel, ProcedureCatalogModel, ToothConditionModel } from '@/modules/catalog/catalog.models';
import { PROCEDURE_CATEGORIES } from '@/modules/catalog/procedureCatalog.seed';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { listRoleTemplates, permissionRegistry, resetRoleTemplate, updateRoleTemplate } from '@/modules/roles/roles.service';
import { pageQuery } from '@/shared/pagination';
import { color, dateOnly, email, entityName, enumOf, freeText, money, nullable, objectId, optional, personName, phone, slug } from '@/shared/validation/fields';
import * as svc from './admin.service';
import * as logs from './logs.service';
import { PlanModel } from './plan.model';

/** Superadmin panel API (04 §8, 05 §7 Platform). Every route requires a platform permission. */
export const adminRouter = Router();
const idParams = z.object({ id: objectId() }).strict();
const int = (min: number, max: number) => z.number().int({ message: 'invalid' }).min(min, { message: 'too_small' }).max(max, { message: 'too_big' });

/* ---------------- dashboard ---------------- */

adminRouter.get('/admin/stats', authorize('platform.stats.read'), asyncHandler(async (_req, res) => ok(res, await svc.platformStats())));

/* ---------------- clinics ---------------- */

const SUB_STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'cancelled'] as const;
const clinicListQuery = z.object({ ...pageQuery, status: enumOf(['active', 'suspended']).optional(), subscription: enumOf([...SUB_STATUSES]).optional(), planId: optional(objectId()) }).strict();
const clinicCreateBody = z
  .object({
    name: entityName({ max: 120 }),
    slug: slug(),
    timezone: optional(z.string().max(60)),
    currency: optional(z.string().length(3).toUpperCase()),
    locale: enumOf(['ar', 'en']).optional(),
    planId: optional(objectId()),
    trialDays: int(0, 365).optional(),
    owner: z.object({ name: personName({ max: 120 }), email: email(), phone: optional(phone()) }).strict(),
  })
  .strict();
const clinicUpdateBody = z
  .object({
    version: z.number().int().min(0),
    name: entityName({ max: 120 }).optional(),
    email: nullable(email()),
    phone: nullable(phone()),
    timezone: z.string().max(60).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    locale: enumOf(['ar', 'en']).optional(),
  })
  .strict();
const reasonBody = z.object({ reason: optional(freeText(300)) }).strict();
const subscriptionBody = z
  .object({
    version: z.number().int().min(0),
    planId: objectId().nullable().optional(),
    status: enumOf([...SUB_STATUSES]).optional(),
    trialEndsAt: nullable(dateOnly()),
    currentPeriodEnd: nullable(dateOnly()),
  })
  .strict();

adminRouter.get(
  '/admin/clinics',
  authorize('platform.clinic.read', 'platform.subscription.manage'),
  validate({ query: clinicListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, clinicListQuery);
    const r = await svc.listClinics(q);
    ok(res, r.items, pageMeta(q.page, q.limit, r.total));
  }),
);
adminRouter.get('/admin/clinics/:id', authorize('platform.clinic.read', 'platform.subscription.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await svc.getClinic(params(req, idParams).id))));
adminRouter.post(
  '/admin/clinics',
  authorize('platform.clinic.manage'),
  validate({ body: clinicCreateBody }),
  asyncHandler(async (req, res) => {
    const c = await svc.createClinicByAdmin(req.auth!, body(req, clinicCreateBody));
    created(res, c, `/admin/clinics/${c.id}`);
  }),
);
adminRouter.patch('/admin/clinics/:id', authorize('platform.clinic.manage'), validate({ params: idParams, body: clinicUpdateBody }), asyncHandler(async (req, res) => ok(res, await svc.updateClinic(params(req, idParams).id, body(req, clinicUpdateBody)))));
adminRouter.post('/admin/clinics/:id/suspend', authorize('platform.clinic.suspend'), validate({ params: idParams, body: reasonBody }), asyncHandler(async (req, res) => ok(res, await svc.setClinicStatus(params(req, idParams).id, 'suspended', body(req, reasonBody).reason))));
adminRouter.post('/admin/clinics/:id/activate', authorize('platform.clinic.suspend'), validate({ params: idParams, body: reasonBody }), asyncHandler(async (req, res) => ok(res, await svc.setClinicStatus(params(req, idParams).id, 'active', body(req, reasonBody).reason))));
adminRouter.patch('/admin/clinics/:id/subscription', authorize('platform.subscription.manage'), validate({ params: idParams, body: subscriptionBody }), asyncHandler(async (req, res) => ok(res, await svc.updateSubscription(params(req, idParams).id, body(req, subscriptionBody)))));

/* ---------------- plans ---------------- */

const planShape = {
  code: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().regex(/^[a-z0-9_-]{2,30}$/, { message: 'invalid_format' })),
  name: entityName({ max: 60 }),
  description: optional(freeText(300)),
  currency: z.string().length(3).toUpperCase(),
  priceMonthly: money(),
  priceYearly: money(),
  trialDays: int(0, 365),
  limits: z.object({ chairs: int(0, 1000), staff: int(0, 10_000), patients: int(0, 10_000_000), monthlyMessages: int(0, 10_000_000), storageGb: int(0, 100_000) }).strict(),
  features: z.array(z.string().trim().regex(/^[a-z0-9_]{2,40}$/, { message: 'invalid_format' })).max(30),
  isActive: z.boolean(),
  sortOrder: int(0, 999),
};
adminRouter.use(
  crudRouter({
    path: '/admin/plans',
    entity: 'plan',
    tag: 'admin',
    model: PlanModel as never,
    perms: { read: ['platform.plan.manage', 'platform.subscription.manage', 'platform.clinic.manage'], create: 'platform.plan.manage', delete: 'platform.plan.manage' },
    createSchema: z.object(planShape).strict(),
    updateSchema: updateOf(planShape),
    sortable: ['sortOrder', 'name', 'priceMonthly', 'createdAt'],
    defaultSort: { sortOrder: 1, name: 1 },
    searchFrom: (b) => b.name as string | undefined,
    unpaged: true,
    beforeDelete: async (doc) => {
      if (await ClinicModel.exists({ planId: doc._id })) throw ApiError.conflict('PLAN_IN_USE', 'Clinics are on this plan; deactivate it instead');
    },
  }),
);

/* ---------------- global catalogs ---------------- */

const activeFilter = { includeInactive: z.enum(['true', 'false']).optional() };
const catalog = <S extends z.ZodRawShape>(path: string, entity: string, model: unknown, shape: S, opts: { sortable: readonly string[]; defaultSort: Record<string, 1 | -1>; searchFrom?: (b: Record<string, unknown>) => string | undefined; filters?: z.ZodRawShape; buildFilter?: (q: Record<string, unknown>) => Record<string, unknown> }) =>
  crudRouter({
    path: `/admin/catalog/${path}`,
    entity,
    tag: 'admin',
    model: model as never,
    perms: { read: 'platform.catalog.manage', create: 'platform.catalog.manage', delete: 'platform.catalog.manage' },
    createSchema: z.object(shape).strict(),
    updateSchema: updateOf(shape),
    sortable: opts.sortable,
    defaultSort: opts.defaultSort,
    filters: { ...activeFilter, ...(opts.filters ?? {}) },
    buildFilter: (q) => opts.buildFilter?.(q) ?? {},
    ...(opts.searchFrom ? { searchFrom: opts.searchFrom } : {}),
  });

const codeOf = (re: RegExp) => z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().regex(re, { message: 'invalid_format' }));
const optionalName = z.string().trim().max(120, { message: 'too_long' }).nullable().optional();

adminRouter.use(
  catalog('procedures', 'catalogProcedure', ProcedureCatalogModel, {
    code: codeOf(/^[A-Za-z0-9.-]{2,20}$/),
    name: optionalName,
    category: enumOf([...PROCEDURE_CATEGORIES] as [string, ...string[]]),
    toothRequired: z.boolean(),
    surfacesRequired: z.boolean(),
    defaultDurationMin: int(5, 480),
    suggestedPrice: money(),
    labRequired: z.boolean(),
    isActive: z.boolean(),
  }, { sortable: ['code', 'category', 'createdAt'], defaultSort: { code: 1 }, filters: { category: z.string().max(40).optional() }, buildFilter: (q) => ({ ...(q.category ? { category: q.category } : {}), ...(q.q ? { code: { $regex: `^${String(q.q).replace(/[^A-Za-z0-9.-]/g, '')}`, $options: 'i' } } : {}) }) }),
);
adminRouter.use(
  catalog('tooth-conditions', 'toothCondition', ToothConditionModel, {
    code: codeOf(/^[a-z0-9_]{2,40}$/),
    name: optionalName,
    color: color(),
    appliesTo: enumOf(['tooth', 'surface']),
    isActive: z.boolean(),
  }, { sortable: ['code', 'createdAt'], defaultSort: { code: 1 } }),
);
adminRouter.use(
  catalog('medicines', 'medicine', MedicineModel, {
    name: entityName({ max: 120 }),
    form: optional(freeText(60)),
    dose: optional(freeText(60)),
    frequency: optional(freeText(60)),
    days: int(0, 365).optional(),
    group: optional(freeText(60)),
    isActive: z.boolean(),
  }, { sortable: ['name', 'group', 'createdAt'], defaultSort: { name: 1 }, searchFrom: (b) => b.name as string | undefined }),
);
adminRouter.use(
  catalog('countries', 'country', CountryModel, {
    code: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{2}$/, { message: 'invalid_format' })),
    name: entityName({ max: 80 }),
    dialCode: optional(codeOf(/^\d{1,4}$/)),
    currency: optional(z.string().length(3).toUpperCase()),
    isActive: z.boolean(),
  }, { sortable: ['code', 'name'], defaultSort: { name: 1 }, searchFrom: (b) => b.name as string | undefined }),
);
adminRouter.use(
  catalog('cities', 'city', CityModel, {
    countryCode: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{2}$/, { message: 'invalid_format' })),
    name: entityName({ max: 80 }),
    isActive: z.boolean(),
  }, { sortable: ['name', 'countryCode'], defaultSort: { name: 1 }, searchFrom: (b) => b.name as string | undefined, filters: { countryCode: z.string().length(2).optional() }, buildFilter: (q) => (q.countryCode ? { countryCode: String(q.countryCode).toUpperCase() } : {}) }),
);
adminRouter.use(
  catalog('currencies', 'currency', CurrencyModel, {
    code: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{3}$/, { message: 'invalid_format' })),
    name: entityName({ max: 60 }),
    symbol: optional(freeText(8)),
    decimals: int(0, 4),
    isActive: z.boolean(),
  }, { sortable: ['code', 'name'], defaultSort: { code: 1 }, searchFrom: (b) => b.name as string | undefined }),
);

/* ---------------- role templates ---------------- */

const templateParams = z.object({ key: z.string().regex(/^[a-z_]{2,40}$/) }).strict();
const grantInput = z.object({ permission: z.string().max(80), scope: z.enum(['own', 'all']).default('all'), fields: z.record(z.enum(['hidden', 'masked', 'read', 'write'])).optional() }).strict();
const templateBody = z.object({ version: z.number().int().min(0), permissions: z.array(grantInput).max(300) }).strict();
adminRouter.get('/admin/permission-registry', authorize('platform.catalog.manage'), (_req, res) => ok(res, permissionRegistry()));
adminRouter.get('/admin/role-templates', authorize('platform.catalog.manage'), asyncHandler(async (_req, res) => ok(res, await listRoleTemplates())));
adminRouter.put('/admin/role-templates/:key', authorize('platform.catalog.manage'), validate({ params: templateParams, body: templateBody }), asyncHandler(async (req, res) => {
  const b = body(req, templateBody);
  ok(res, await updateRoleTemplate(params(req, templateParams).key, { version: b.version, permissions: b.permissions as Grant[] }));
}));
adminRouter.post('/admin/role-templates/:key/reset', authorize('platform.catalog.manage'), validate({ params: templateParams }), asyncHandler(async (req, res) => ok(res, await resetRoleTemplate(params(req, templateParams).key))));

/* ---------------- users ---------------- */

const userListQuery = z.object({ ...pageQuery, kind: enumOf(['platform', 'staff', 'patient']).optional(), status: enumOf(['active', 'disabled', 'locked']).optional() }).strict();
adminRouter.get(
  '/admin/users',
  authorize('platform.user.read'),
  validate({ query: userListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, userListQuery);
    const r = await svc.listUsers(q);
    ok(res, r.items, pageMeta(q.page, q.limit, r.total));
  }),
);
for (const action of ['disable', 'enable', 'unlock'] as const) {
  adminRouter.post(`/admin/users/:id/${action}`, authorize('platform.user.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await svc.setUserStatus(req.auth!, params(req, idParams).id, action))));
}

/* ---------------- superadmins ---------------- */

const permissionList = z.array(z.string().max(80)).max(PLATFORM_PERMISSION_KEYS.length);
const inviteBody = z.object({ name: personName({ max: 120 }), email: email(), permissions: permissionList }).strict();
adminRouter.get('/admin/platform-permissions', authorize('platform.superadmin.manage'), (_req, res) => ok(res, PLATFORM_PERMISSION_KEYS));
adminRouter.get('/admin/superadmins', authorize('platform.superadmin.manage'), asyncHandler(async (_req, res) => ok(res, await svc.listSuperadmins())));
adminRouter.post('/admin/superadmins', authorize('platform.superadmin.manage'), validate({ body: inviteBody }), asyncHandler(async (req, res) => {
  const u = await svc.inviteSuperadmin(req.auth!, body(req, inviteBody));
  created(res, u, `/admin/superadmins/${u.id}`);
}));
adminRouter.put('/admin/superadmins/:id/permissions', authorize('platform.superadmin.manage'), validate({ params: idParams, body: z.object({ permissions: permissionList }).strict() }), asyncHandler(async (req, res) => ok(res, await svc.setSuperadminPermissions(req.auth!, params(req, idParams).id, (req.valid.body as { permissions: string[] }).permissions))));
adminRouter.post('/admin/superadmins/:id/disable', authorize('platform.superadmin.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await svc.setSuperadminStatus(req.auth!, params(req, idParams).id, 'disabled'))));
adminRouter.post('/admin/superadmins/:id/enable', authorize('platform.superadmin.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await svc.setSuperadminStatus(req.auth!, params(req, idParams).id, 'active'))));

/* ---------------- logs ---------------- */

const kindParams = z.object({ kind: z.enum(logs.LOG_KINDS) }).strict();
const logQuery = z
  .object({
    ...pageQuery,
    clinicId: optional(objectId()),
    userId: optional(objectId()),
    from: optional(dateOnly()),
    to: optional(dateOnly()),
    status: optional(z.string().max(20)),
    type: optional(z.string().max(40)),
    format: z.enum(['json', 'csv']).optional(),
  })
  .strict();
const canRead = (auth: AuthContext, kind: logs.LogKind) => auth.isRoot || Boolean(auth.grants[logs.LOG_PERMISSION[kind]]);
const anyLog = Object.values(logs.LOG_PERMISSION);

adminRouter.get(
  '/admin/logs/timeline',
  authorize('platform.logs.activity.read'),
  validate({ query: z.object({ userId: optional(objectId()), sessionId: optional(z.string().max(80)), from: optional(dateOnly()), to: optional(dateOnly()) }).strict() }),
  asyncHandler(async (req, res) => ok(res, await logs.timeline(req.valid.query as { userId?: string; sessionId?: string; from?: string; to?: string }))),
);
adminRouter.get(
  '/admin/logs/:kind',
  authorize(...anyLog),
  (req, res, next) => (req.query.format === 'csv' ? exportRateLimit(req, res, next) : next()),
  validate({ params: kindParams, query: logQuery }),
  asyncHandler(async (req, res) => {
    const { kind } = params(req, kindParams);
    // Each log kind has its own permission (15 §6).
    if (!canRead(req.auth!, kind)) throw ApiError.forbidden('FORBIDDEN', 'Missing permission', { permission: logs.LOG_PERMISSION[kind] });
    const q = query(req, logQuery);
    if (q.format === 'csv') {
      const csv = await logs.exportLogs(req.auth!, kind, q);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${kind}-logs.csv"`);
      res.send(csv);
      return;
    }
    const r = await logs.listLogs(kind, q);
    ok(res, r.items, pageMeta(q.page, q.limit, r.total));
  }),
);
const logItemBody = z.object({ status: optional(z.enum(['new', 'acknowledged', 'resolved', 'ignored'])), notes: optional(freeText(2000)), assigneeId: objectId().nullable().optional() }).strict();
adminRouter.patch('/admin/logs/issues/:id', authorize('platform.logs.issues.read'), validate({ params: idParams, body: logItemBody }), asyncHandler(async (req, res) => ok(res, await logs.updateLogItem(req.auth!, 'issues', params(req, idParams).id, body(req, logItemBody)))));
adminRouter.patch(
  '/admin/logs/errors/:id',
  authorize('platform.logs.errors.read'),
  validate({ params: idParams, body: logItemBody.refine((b) => b.status !== 'ignored', { path: ['status'], message: 'invalid_option' }) }),
  asyncHandler(async (req, res) => ok(res, await logs.updateLogItem(req.auth!, 'errors', params(req, idParams).id, body(req, logItemBody)))),
);

registerPath({ method: 'get', path: '/admin/stats', tags: ['admin'], summary: 'Platform dashboard' });
registerPath({ method: 'get', path: '/admin/clinics', tags: ['admin'], summary: 'Clinics (search, status, subscription, plan)', query: clinicListQuery });
registerPath({ method: 'post', path: '/admin/clinics', tags: ['admin'], summary: 'Create a clinic and invite its owner', body: clinicCreateBody });
registerPath({ method: 'patch', path: '/admin/clinics/:id/subscription', tags: ['admin'], summary: 'Plan, status and dates of a clinic subscription', params: idParams, body: subscriptionBody });
registerPath({ method: 'get', path: '/admin/users', tags: ['admin'], summary: 'All accounts', query: userListQuery });
registerPath({ method: 'post', path: '/admin/superadmins', tags: ['admin'], summary: 'Invite a superadmin (escalation rule)', body: inviteBody });
registerPath({ method: 'get', path: '/admin/logs/:kind', tags: ['admin'], summary: 'Audit / activity / issues / errors / requests (CSV with format=csv)', params: kindParams, query: logQuery });
registerPath({ method: 'get', path: '/admin/role-templates', tags: ['admin'], summary: 'Global role templates for new clinics' });
