import { Router } from 'express';
import { z } from 'zod';
import { env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import { crudRouter, updateOf } from '@/core/crud/crudRouter';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { defineJob, defineRepeatable } from '@/core/jobs/queue';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { currentClinicId, runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { body, params, query, validate } from '@/core/validation/validate';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { registerClinicSeeder } from '@/modules/platform/onboarding.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { addDays, localDate } from '@/shared/dates';
import { dateOnly, entityName, freeText, money, objectId, optional, requiredText, timeOfDay } from '@/shared/validation/fields';
import { LeaveTypeModel, SalaryComponentModel, ShiftModel } from './hr.models';
import * as hr from './hr.service';
import * as pay from './payroll.service';

export const hrRouter = Router();
const idParams = z.object({ id: objectId() }).strict();

/* ---------- shifts ---------- */

const shiftShape = {
  name: entityName({ max: 60 }),
  weekly: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: timeOfDay(), end: timeOfDay(), breakMinutes: z.number().int().min(0).max(240).default(0) }).strict()).max(7).default([]),
  graceMinutes: z.number().int().min(0).max(120).default(10),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
};
hrRouter.use(
  crudRouter({
    path: '/shifts',
    entity: 'shift',
    tag: 'hr',
    model: ShiftModel as never,
    perms: { read: ['hr.shift.manage', 'hr.attendance.adjust'], create: 'hr.shift.manage' },
    createSchema: z.object(shiftShape).strict(),
    updateSchema: updateOf(shiftShape),
    sortable: ['name', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => b.name as string,
    unpaged: true,
    afterWrite: async (doc, _auth, kind) => {
      // Only one default shift per clinic.
      if (kind !== 'delete' && doc.isDefault) await ShiftModel.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
    },
  }),
);

const assignBody = z.object({ staffIds: z.array(objectId()).max(200) }).strict();
hrRouter.post(
  '/shifts/:id/assign',
  authorize('hr.shift.manage'),
  validate({ params: idParams, body: assignBody }),
  asyncHandler(async (req, res) => {
    const shiftId = params(req, idParams).id;
    if (!(await ShiftModel.exists({ _id: shiftId }))) throw ApiError.notFound();
    const b = body(req, assignBody);
    await StaffModel.updateMany({ _id: { $in: b.staffIds } }, { $set: { shiftId } });
    await recordAudit({ action: 'update', entity: 'shift', entityId: shiftId, summary: `assigned to ${b.staffIds.length}` });
    ok(res, { assigned: b.staffIds.length });
  }),
);

/* ---------- attendance ---------- */

const geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().optional();
hrRouter.get('/attendance/me', authorize('hr.attendance.checkin', 'hr.attendance.read'), asyncHandler(async (req, res) => ok(res, await hr.myToday(req.auth!))));
hrRouter.post('/attendance/check-in', authorize('hr.attendance.checkin'), validate({ body: z.object({ geo }).strict() }), asyncHandler(async (req, res) => ok(res, await hr.punch(req.auth!, 'in', 'web', (req.valid.body as { geo?: { lat: number; lng: number } }).geo))));
hrRouter.post('/attendance/check-out', authorize('hr.attendance.checkin'), validate({ body: z.object({ geo }).strict() }), asyncHandler(async (req, res) => ok(res, await hr.punch(req.auth!, 'out', 'web', (req.valid.body as { geo?: { lat: number; lng: number } }).geo))));

/** Rotating QR shown on the reception screen (08 §3). */
hrRouter.get(
  '/attendance/qr',
  authorize('hr.attendance.adjust'),
  asyncHandler(async (_req, res) => {
    const token = hr.qrToken(String(currentClinicId()));
    // The code opens the attendance page, which checks the scanning staff member in.
    const url = `${env.FRONTEND_URL}/clinic/hr/attendance?qr=${encodeURIComponent(token)}`;
    const image = await (await import('qrcode')).toDataURL(url, { margin: 1, width: 320 });
    ok(res, { token, url, image, validForSeconds: 60 });
  }),
);
const qrBody = z.object({ token: z.string().max(80), kind: z.enum(['in', 'out']) }).strict();
hrRouter.post(
  '/attendance/qr',
  authorize('hr.attendance.checkin'),
  validate({ body: qrBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, qrBody);
    if (!hr.verifyQr(String(currentClinicId()), b.token)) throw ApiError.validation([{ path: 'token', code: 'code_expired' }]);
    ok(res, await hr.punch(req.auth!, b.kind, 'qr'));
  }),
);

const attQuery = z.object({ from: dateOnly(), to: dateOnly(), staffId: optional(objectId()) }).strict();
hrRouter.get('/attendance', authorize('hr.attendance.read'), validate({ query: attQuery }), asyncHandler(async (req, res) => ok(res, await hr.listAttendance(req.auth!, query(req, attQuery)))));
const adjustBody = z
  .object({ staffId: objectId(), date: dateOnly(), checkIn: timeOfDay().nullable().optional(), checkOut: timeOfDay().nullable().optional(), status: z.enum(['present', 'absent', 'on_leave', 'holiday', 'weekend']).optional(), overtimeApproved: z.boolean().optional(), reason: requiredText(300) })
  .strict();
hrRouter.post('/attendance/adjust', authorize('hr.attendance.adjust'), validate({ body: adjustBody }), asyncHandler(async (req, res) => ok(res, await hr.adjustAttendance(req.auth!, body(req, adjustBody)))));

/* ---------- leave ---------- */

const leaveTypeShape = {
  code: z.string().trim().regex(/^[a-z_]{2,20}$/, { message: 'invalid_format' }),
  name: entityName({ max: 60 }).nullable().optional(),
  paid: z.boolean().default(true),
  annualEntitlementDays: z.number().min(0).max(365).default(0),
  accrual: z.enum(['yearly', 'monthly']).default('yearly'),
  carryOverMaxDays: z.number().min(0).max(365).default(0),
  requiresAttachment: z.boolean().default(false),
  seniorityRule: z.object({ afterYears: z.number().int().min(1).max(50), days: z.number().min(0).max(365) }).strict().optional(),
  isActive: z.boolean().default(true),
};
hrRouter.use(
  crudRouter({
    path: '/leave-types',
    entity: 'leaveType',
    tag: 'hr',
    model: LeaveTypeModel as never,
    perms: { read: ['hr.leave.request', 'hr.leave.read', 'hr.leaveType.manage'], create: 'hr.leaveType.manage' },
    createSchema: z.object(leaveTypeShape).strict(),
    updateSchema: updateOf(leaveTypeShape),
    sortable: ['code', 'createdAt'],
    defaultSort: { code: 1 },
    searchFrom: (b) => (b.name as string) ?? (b.code as string),
    unpaged: true,
  }),
);

const balanceQuery = z.object({ staffId: optional(objectId()), year: z.coerce.number().int().min(2000).max(2100).optional() }).strict();
hrRouter.get(
  '/leave-balances',
  authorize('hr.leave.read', 'hr.leave.request'),
  validate({ query: balanceQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, balanceQuery);
    const staffId = q.staffId && (req.auth!.isOwner || scopeFor(req.auth!, 'hr.leave.read') === 'all') ? q.staffId : req.auth!.staffId;
    if (!staffId) throw ApiError.forbidden();
    ok(res, await hr.balancesFor(staffId, q.year ?? new Date().getUTCFullYear()));
  }),
);

const leaveQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), staffId: optional(objectId()), from: optional(dateOnly()), to: optional(dateOnly()) }).strict();
hrRouter.get('/leave-requests', authorize('hr.leave.read', 'hr.leave.request'), validate({ query: leaveQuery }), asyncHandler(async (req, res) => ok(res, await hr.listLeave(req.auth!, query(req, leaveQuery)))));
const leaveBody = z.object({ staffId: optional(objectId()), leaveTypeId: objectId(), startDate: dateOnly(), endDate: dateOnly(), halfDay: z.boolean().optional(), reason: optional(freeText(500)), attachmentFileId: optional(objectId()) }).strict();
hrRouter.post('/leave-requests', authorize('hr.leave.request', 'hr.leave.approve'), validate({ body: leaveBody }), asyncHandler(async (req, res) => created(res, await hr.requestLeave(req.auth!, body(req, leaveBody)))));
const decideBody = z.object({ comment: optional(freeText(300)), confirmConflicts: z.boolean().optional() }).strict();
hrRouter.post('/leave-requests/:id/approve', authorize('hr.leave.approve'), validate({ params: idParams, body: decideBody }), asyncHandler(async (req, res) => ok(res, await hr.decideLeave(req.auth!, params(req, idParams).id, 'approved', body(req, decideBody)))));
hrRouter.post('/leave-requests/:id/reject', authorize('hr.leave.approve'), validate({ params: idParams, body: decideBody }), asyncHandler(async (req, res) => ok(res, await hr.decideLeave(req.auth!, params(req, idParams).id, 'rejected', body(req, decideBody)))));
hrRouter.post('/leave-requests/:id/cancel', authorize('hr.leave.request', 'hr.leave.approve'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await hr.cancelLeave(req.auth!, params(req, idParams).id))));

/* ---------- salary components ---------- */

const componentShape = { name: entityName({ max: 60 }), kind: z.enum(['earning', 'deduction']), calc: z.enum(['fixed', 'percent_of_basic', 'per_hour']).default('fixed'), taxable: z.boolean().default(true), subjectToSocialSecurity: z.boolean().default(false), accountId: optional(objectId()), isActive: z.boolean().default(true) };
hrRouter.use(
  crudRouter({
    path: '/salary-components',
    entity: 'salaryComponent',
    tag: 'hr',
    model: SalaryComponentModel as never,
    perms: { read: ['hr.compensation.read', 'hr.payroll.run'], create: 'hr.compensation.update' },
    createSchema: z.object(componentShape).strict(),
    updateSchema: updateOf(componentShape),
    sortable: ['name', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => b.name as string,
    unpaged: true,
  }),
);

/* ---------- payroll ---------- */

hrRouter.get('/payroll-runs', authorize('hr.payroll.run', 'hr.payroll.approve'), asyncHandler(async (_req, res) => ok(res, await pay.listRuns())));
const runBody = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }).strict();
hrRouter.post('/payroll-runs', authorize('hr.payroll.run'), validate({ body: runBody }), asyncHandler(async (req, res) => {
  const b = body(req, runBody);
  created(res, await pay.createRun(req.auth!, b.year, b.month));
}));
hrRouter.get('/payroll-runs/:id', authorize('hr.payroll.run', 'hr.payroll.approve'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await pay.getRun(req.auth!, params(req, idParams).id))));
hrRouter.post('/payroll-runs/:id/calculate', authorize('hr.payroll.run'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await pay.calculateRun(req.auth!, params(req, idParams).id))));
const oneOffBody = z.object({ staffId: objectId(), kind: z.enum(['earning', 'deduction']), name: requiredText(60), amount: money({ positive: true }), reason: requiredText(300) }).strict();
hrRouter.post('/payroll-runs/:id/lines', authorize('hr.payroll.run'), validate({ params: idParams, body: oneOffBody }), asyncHandler(async (req, res) => ok(res, await pay.addOneOff(req.auth!, params(req, idParams).id, body(req, oneOffBody)))));
const lineParams = z.object({ id: objectId(), lineId: objectId() }).strict();
hrRouter.delete('/payroll-runs/:id/lines/:lineId', authorize('hr.payroll.run'), validate({ params: lineParams }), asyncHandler(async (req, res) => {
  const p = params(req, lineParams);
  ok(res, await pay.removeOneOff(req.auth!, p.id, p.lineId));
}));
hrRouter.post('/payroll-runs/:id/approve', authorize('hr.payroll.approve'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await pay.approveRun(req.auth!, params(req, idParams).id))));
const payBody = z.object({ paidFromAccountId: objectId() }).strict();
hrRouter.post('/payroll-runs/:id/pay', authorize('hr.payroll.approve'), validate({ params: idParams, body: payBody }), asyncHandler(async (req, res) => ok(res, await pay.payRun(req.auth!, params(req, idParams).id, body(req, payBody).paidFromAccountId))));
hrRouter.post('/payroll-runs/:id/cancel', authorize('hr.payroll.run'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await pay.cancelRun(req.auth!, params(req, idParams).id))));

hrRouter.get('/payslips/mine', authorize('hr.payroll.read'), asyncHandler(async (req, res) => ok(res, await pay.myPayslips(req.auth!))));
hrRouter.get('/payslips/:id', authorize('hr.payroll.read'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await pay.getPayslip(req.auth!, params(req, idParams).id))));
hrRouter.post('/payslips/:id/acknowledge', authorize('hr.payroll.read'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await pay.acknowledge(req.auth!, params(req, idParams).id))));

/* ---------- jobs & seeds ---------- */

/** Nightly per clinic: yesterday's missing rows → absent / on leave / holiday / weekend. */
defineJob('maintenance', 'attendance.closeDay', async () => {
  const clinics = await runWithoutTenant(() => ClinicModel.find({}).select('timezone').lean());
  for (const c of clinics) {
    const yesterday = addDays(localDate(new Date(), c.timezone ?? 'Asia/Amman'), -1);
    await runInTenant(c._id, () => hr.closeDay(yesterday));
  }
});
defineRepeatable('maintenance', 'attendance.closeDay', { pattern: '30 1 * * *', tz: 'Asia/Amman' });

/** Jordan defaults (08 §4) — seed values only, every clinic can change them. */
export const DEFAULT_LEAVE_TYPES = [
  { code: 'annual', systemKey: 'annual', paid: true, annualEntitlementDays: 14, accrual: 'yearly', carryOverMaxDays: 7, seniorityRule: { afterYears: 5, days: 21 } },
  { code: 'sick', systemKey: 'sick', paid: true, annualEntitlementDays: 14, accrual: 'yearly', requiresAttachment: true },
  { code: 'maternity', systemKey: 'maternity', paid: true, annualEntitlementDays: 70, accrual: 'yearly' },
  { code: 'hajj', systemKey: 'hajj', paid: true, annualEntitlementDays: 14, accrual: 'yearly' },
  { code: 'unpaid', systemKey: 'unpaid', paid: false, annualEntitlementDays: 0, accrual: 'yearly' },
];
const DEFAULT_SHIFT = { name: 'Clinic hours', searchName: 'clinic hours', isDefault: true, graceMinutes: 10, weekly: [6, 0, 1, 2, 3, 4].map((weekday) => ({ weekday, start: '09:00', end: '17:00', breakMinutes: 30 })) };
const DEFAULT_COMPONENTS = [
  { name: 'Transport allowance', searchName: 'transport allowance', kind: 'earning', calc: 'fixed', taxable: false, subjectToSocialSecurity: false },
  { name: 'Housing allowance', searchName: 'housing allowance', kind: 'earning', calc: 'percent_of_basic', taxable: true, subjectToSocialSecurity: true },
  { name: 'Loan repayment', searchName: 'loan repayment', kind: 'deduction', calc: 'fixed', taxable: false, subjectToSocialSecurity: false },
];

async function seedHr(session?: import('mongoose').ClientSession) {
  if (!(await LeaveTypeModel.exists({}).session(session ?? null))) await LeaveTypeModel.insertMany(DEFAULT_LEAVE_TYPES.map((t) => structuredClone({ ...t, name: null, searchName: t.code })), { session });
  if (!(await ShiftModel.exists({}).session(session ?? null))) await ShiftModel.create([structuredClone(DEFAULT_SHIFT)], { session });
  if (!(await SalaryComponentModel.exists({}).session(session ?? null))) await SalaryComponentModel.insertMany(DEFAULT_COMPONENTS.map((c) => ({ ...c })), { session });
}
registerClinicSeeder({ name: 'hr.defaults', run: (_c, session) => seedHr(session) });
registerDemoSeeder({ name: 'hr.demo', order: 45, run: (clinicId) => runInTenant(clinicId, () => seedHr()) });

registerPath({ method: 'post', path: '/payroll-runs/:id/calculate', tags: ['hr'], summary: 'Calculate payslips (pure calculator)', params: idParams });
registerPath({ method: 'post', path: '/leave-requests', tags: ['hr'], summary: 'Request leave (days computed server-side)', body: leaveBody });
