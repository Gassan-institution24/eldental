import { Router } from 'express';
import { Schema, Types, model } from 'mongoose';
import { z } from 'zod';
import { applyBase } from '@/core/db/plugins';
import { emit, on } from '@/core/events/bus';
import { asyncHandler } from '@/core/http/asyncHandler';
import { noContent, ok } from '@/core/http/response';
import { authorize } from '@/core/rbac/authorize';
import { sendToUser } from '@/core/realtime/socket';
import { runInTenant, runWithoutTenant, tenantField } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { localDate, localTime } from '@/shared/dates';
import { params, query, validate } from '@/core/validation/validate';
import { objectId } from '@/shared/validation/fields';
import { StaffModel } from '@/modules/staff/staff.model';

/**
 * In-app notifications (03 §11). Texts are i18n keys + params so each user sees their own
 * language; links point inside the app. Nothing secret or typed by users is stored here.
 */
const notificationSchema = new Schema(
  {
    clinicId: tenantField,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    titleKey: String,
    bodyKey: String,
    params: { type: Schema.Types.Mixed, default: {} },
    link: String,
    priority: { type: String, enum: ['normal', 'high'], default: 'normal' },
    readAt: Date,
  },
  { timestamps: true, collection: 'notifications', minimize: false },
);
applyBase(notificationSchema, { softDelete: false });
notificationSchema.index({ clinicId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
export const NotificationModel = model('Notification', notificationSchema);

export type NotifyInput = { type: string; titleKey: string; bodyKey?: string; params?: Record<string, string | number>; link?: string; priority?: 'normal' | 'high' };

export async function notify(clinicId: string, userIds: (string | Types.ObjectId | null | undefined)[], n: NotifyInput) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  await runInTenant(clinicId, async () => {
    const docs = await NotificationModel.insertMany(ids.map((userId) => ({ userId, ...n, params: n.params ?? {} })));
    for (const d of docs) {
      sendToUser(String(d.userId), 'notification:new', { id: String(d._id), type: n.type });
      await emit('notification.created', { clinicId, userId: String(d.userId), notificationId: String(d._id) });
    }
  });
}

/** Users of active staff who are owners or of the given staff types. */
export async function usersOf(clinicId: string, filter: { owners?: boolean; staffTypes?: string[]; staffIds?: (string | Types.ObjectId)[] }) {
  return runInTenant(clinicId, async () => {
    const or: Record<string, unknown>[] = [];
    if (filter.owners) or.push({ isOwner: true });
    if (filter.staffTypes?.length) or.push({ staffType: { $in: filter.staffTypes } });
    if (filter.staffIds?.length) or.push({ _id: { $in: filter.staffIds } });
    if (!or.length) return [];
    return (await StaffModel.find({ status: 'active', $or: or }).select('userId').lean()).map((s) => String(s.userId));
  });
}

/* ---------- routes ---------- */

export const notificationsRouter = Router();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

notificationsRouter.get(
  '/notifications',
  authorize.self('staff', 'patient'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    if (!auth.clinicId) return ok(res, { items: [], unread: 0 });
    const q = query(req, listQuery);
    const filter = { userId: new Types.ObjectId(auth.userId) };
    const [items, unread] = await Promise.all([NotificationModel.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean(), NotificationModel.countDocuments({ ...filter, readAt: null })]);
    ok(res, { items: items.map((n) => ({ id: String(n._id), type: n.type, titleKey: n.titleKey, bodyKey: n.bodyKey, params: n.params, link: n.link, priority: n.priority, readAt: n.readAt ?? null, createdAt: n.createdAt })), unread });
  }),
);

const idParams = z.object({ id: objectId() }).strict();
notificationsRouter.post(
  '/notifications/:id/read',
  authorize.self('staff', 'patient'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await NotificationModel.updateOne({ _id: params(req, idParams).id, userId: req.auth!.userId }, { $set: { readAt: new Date() } });
    noContent(res);
  }),
);
notificationsRouter.post(
  '/notifications/read-all',
  authorize.self('staff', 'patient'),
  asyncHandler(async (req, res) => {
    await NotificationModel.updateMany({ userId: req.auth!.userId, readAt: null }, { $set: { readAt: new Date() } });
    noContent(res);
  }),
);

/* ---------- event wiring (who hears about what) ---------- */

async function clinicTime(clinicId: string, at: Date) {
  const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('timezone').lean());
  const tz = clinic?.timezone ?? 'Asia/Amman';
  return `${localDate(at, tz)} ${localTime(at, tz)}`;
}

on('leave.approved', async ({ clinicId, leaveRequestId }) => {
  const { LeaveRequestModel } = await import('@/modules/hr/hr.models');
  const r = await runInTenant(clinicId, () => LeaveRequestModel.findById(leaveRequestId).select('staffId status').lean());
  if (!r) return;
  await notify(clinicId, await usersOf(clinicId, { staffIds: [r.staffId] }), { type: 'leave_decided', titleKey: 'notifications:types.leave_decided', bodyKey: 'notifications:msg.leaveDecided', params: { decision: r.status }, link: '/clinic/hr/leave' });
});

on('payroll.approved', async ({ clinicId, payrollRunId }) => {
  const { PayrollRunModel, PayslipModel } = await import('@/modules/hr/hr.models');
  const [run, slips] = await runInTenant(clinicId, () => Promise.all([PayrollRunModel.findById(payrollRunId).lean(), PayslipModel.find({ payrollRunId }).select('staffId').lean()]));
  if (!run) return;
  await notify(clinicId, await usersOf(clinicId, { staffIds: slips.map((s) => s.staffId) }), { type: 'payslip_ready', titleKey: 'notifications:types.payslip_ready', bodyKey: 'notifications:msg.payslipReady', params: { period: `${run.year}-${String(run.month).padStart(2, '0')}` }, link: '/clinic/hr/my-payslips' });
});

on('appointment.cancelled', async ({ clinicId, appointmentId, actorUserId }) => {
  const { AppointmentModel } = await import('@/modules/scheduling/scheduling.models');
  const a = await runInTenant(clinicId, () => AppointmentModel.findById(appointmentId).select('dentistId start').lean());
  if (!a) return;
  const users = (await usersOf(clinicId, { staffIds: [a.dentistId] })).filter((u) => u !== actorUserId);
  await notify(clinicId, users, { type: 'appointment_cancelled', titleKey: 'notifications:types.appointment_cancelled', bodyKey: 'notifications:msg.appointmentCancelled', params: { patient: '', time: await clinicTime(clinicId, a.start) }, link: `/clinic/calendar?appointment=${appointmentId}` });
});
