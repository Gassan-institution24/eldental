import { Router } from 'express';
import { Types } from 'mongoose';
import { crudRouter, defaultDto } from '@/core/crud/crudRouter';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, noContent, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { body, params, query, validate } from '@/core/validation/validate';
import { objectId } from '@/shared/validation/fields';
import { registerOwnPatientSource } from '@/modules/patients/patient.service';
import { registerTimelineSource } from '@/modules/patients/patient.routes';
import { onBeforeStaffDeactivate } from '@/modules/staff/staff.service';
import { addDays, startOfLocalDay } from '@/shared/dates';
import { z } from 'zod';
import * as plan from './planning.service';
import { AppointmentModel, ScheduleExceptionModel } from './scheduling.models';
import * as s from './scheduling.schemas';
import * as svc from './scheduling.service';
import './scheduling.events';

export const schedulingRouter = Router();
const A = 'scheduling.appointment';

/* ---------- availability ---------- */

schedulingRouter.get(
  '/availability',
  authorize(`${A}.book`, `${A}.read`),
  validate({ query: s.availabilityQuery }),
  asyncHandler(async (req, res) => ok(res, await svc.availability(req.auth!, query(req, s.availabilityQuery)))),
);

/* ---------- appointments ---------- */

schedulingRouter.get(
  '/appointments',
  authorize(`${A}.read`),
  validate({ query: s.listQuery }),
  asyncHandler(async (req, res) => ok(res, await svc.listAppointments(req.auth!, query(req, s.listQuery)))),
);

schedulingRouter.get(
  '/appointments/today-board',
  authorize(`${A}.read`),
  validate({ query: s.boardQuery }),
  asyncHandler(async (req, res) => ok(res, await svc.todayBoard(req.auth!, query(req, s.boardQuery).date))),
);

schedulingRouter.get(
  '/patients/:id/appointments',
  authorize(`${A}.read`),
  validate({ params: s.idParams }),
  asyncHandler(async (req, res) => ok(res, await svc.patientAppointments(req.auth!, params(req, s.idParams).id))),
);

schedulingRouter.get('/appointments/:id', authorize(`${A}.read`), validate({ params: s.idParams }), asyncHandler(async (req, res) => ok(res, await svc.getAppointment(req.auth!, params(req, s.idParams).id))));

schedulingRouter.post(
  '/appointments',
  authorize(`${A}.book`),
  validate({ body: s.bookBody }),
  asyncHandler(async (req, res) => {
    const a = await svc.book(req.auth!, body(req, s.bookBody));
    created(res, a, `/appointments/${a.id}`);
  }),
);

schedulingRouter.patch(
  '/appointments/:id',
  authorize(`${A}.update`),
  validate({ params: s.idParams, body: s.updateBody }),
  asyncHandler(async (req, res) => ok(res, await svc.updateAppointment(req.auth!, params(req, s.idParams).id, body(req, s.updateBody)))),
);

/** Any status change; the service checks the permission of the target status (06 §4). */
schedulingRouter.post(
  '/appointments/:id/status',
  authorize(`${A}.update`, `${A}.checkin`, `${A}.cancel`),
  validate({ params: s.idParams, body: s.statusBody }),
  asyncHandler(async (req, res) => ok(res, await svc.transition(req.auth!, params(req, s.idParams).id, body(req, s.statusBody)))),
);

schedulingRouter.post(
  '/appointments/:id/cancel',
  authorize(`${A}.cancel`),
  validate({ params: s.idParams, body: s.cancelBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.cancelBody);
    ok(res, await svc.transition(req.auth!, params(req, s.idParams).id, { to: 'cancelled', reason: b.reason, ...(b.comment ? { comment: b.comment } : {}), ...(b.version !== undefined ? { version: b.version } : {}) }));
  }),
);

schedulingRouter.post(
  '/appointments/bulk-shift',
  authorize(`${A}.update`),
  validate({ body: s.bulkShiftBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, s.bulkShiftBody);
    ok(res, await svc.bulkShift(req.auth!, b.ids, b.minutes));
  }),
);

/* ---------- dentist schedules ---------- */

schedulingRouter.get('/dentist-schedules', authorize('scheduling.schedule.read'), asyncHandler(async (req, res) => ok(res, await plan.listSchedules(req.auth!))));

schedulingRouter.put(
  '/dentist-schedules/:staffId',
  authorize('scheduling.schedule.manage'),
  validate({ params: s.staffParams, body: s.scheduleBody }),
  asyncHandler(async (req, res) => ok(res, await plan.saveSchedule(req.auth!, params(req, s.staffParams).staffId, body(req, s.scheduleBody)))),
);

const versionParams = z.object({ staffId: objectId(), id: objectId() }).strict();
schedulingRouter.delete(
  '/dentist-schedules/:staffId/versions/:id',
  authorize('scheduling.schedule.manage'),
  validate({ params: versionParams }),
  asyncHandler(async (req, res) => {
    const p = params(req, versionParams);
    await plan.deleteScheduleVersion(req.auth!, p.staffId, p.id);
    noContent(res);
  }),
);

/* ---------- schedule exceptions ---------- */

schedulingRouter.get(
  '/schedule-exceptions',
  authorize('scheduling.schedule.read'),
  validate({ query: s.exceptionQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, s.exceptionQuery);
    const clinic = await svc.loadClinic();
    const tz = clinic.timezone ?? 'Asia/Amman';
    const rows = await ScheduleExceptionModel.find({
      start: { $lt: startOfLocalDay(addDays(q.to, 1), tz) },
      end: { $gt: startOfLocalDay(q.from, tz) },
      ...(q.staffId ? { $or: [{ staffId: q.staffId }, { staffId: null }] } : {}),
    })
      .sort({ start: 1 })
      .lean();
    ok(res, rows.map((r) => ({ ...defaultDto(r as never), staffId: r.staffId ? String(r.staffId) : undefined, chairId: r.chairId ? String(r.chairId) : undefined })));
  }),
);

schedulingRouter.use(
  crudRouter({
    path: '/schedule-exceptions',
    entity: 'scheduleException',
    tag: 'scheduling',
    model: ScheduleExceptionModel as never,
    perms: { read: 'scheduling.schedule.read', create: 'scheduling.schedule.manage' },
    createSchema: s.exceptionBody,
    updateSchema: s.exceptionUpdateBody,
    sortable: ['start'],
    defaultSort: { start: 1 },
    softDelete: false,
    scope: { own: (auth) => ({ staffId: new Types.ObjectId(auth.staffId) }) },
    toModel: (b, auth) => {
      // Own scope may only manage its own time off; clinic-wide entries need full rights.
      if (scopeFor(auth, 'scheduling.schedule.manage') === 'own' && b.staffId !== undefined && b.staffId !== auth.staffId) throw ApiError.forbidden();
      if (scopeFor(auth, 'scheduling.schedule.manage') === 'own' && !b.staffId && b.type !== undefined) throw ApiError.forbidden();
      return b;
    },
  }),
);

/* ---------- waiting list ---------- */

schedulingRouter.get('/waiting-list', authorize('scheduling.waitlist.manage', `${A}.book`), validate({ query: s.waitlistQuery }), asyncHandler(async (req, res) => ok(res, await plan.listWaitlist(query(req, s.waitlistQuery)))));

schedulingRouter.post(
  '/waiting-list',
  authorize('scheduling.waitlist.manage'),
  validate({ body: s.waitlistBody }),
  asyncHandler(async (req, res) => created(res, await plan.addToWaitlist(body(req, s.waitlistBody)))),
);

schedulingRouter.patch(
  '/waiting-list/:id',
  authorize('scheduling.waitlist.manage'),
  validate({ params: s.idParams, body: s.waitlistUpdateBody }),
  asyncHandler(async (req, res) => ok(res, await plan.updateWaitlist(params(req, s.idParams).id, body(req, s.waitlistUpdateBody)))),
);

/* ---------- recalls ---------- */

schedulingRouter.get('/recalls', authorize('scheduling.recall.manage'), validate({ query: s.recallQuery }), asyncHandler(async (req, res) => ok(res, await plan.listRecalls(query(req, s.recallQuery)))));

schedulingRouter.post('/recalls', authorize('scheduling.recall.manage'), validate({ body: s.recallBody }), asyncHandler(async (req, res) => created(res, await plan.createRecall(body(req, s.recallBody)))));

schedulingRouter.patch(
  '/recalls/:id',
  authorize('scheduling.recall.manage'),
  validate({ params: s.idParams, body: s.recallUpdateBody }),
  asyncHandler(async (req, res) => ok(res, await plan.updateRecall(params(req, s.idParams).id, body(req, s.recallUpdateBody)))),
);

/* ---------- cross-module hooks ---------- */

registerOwnPatientSource(async (staffId) => AppointmentModel.distinct('patientId', { $or: [{ dentistId: staffId }, { assistantIds: staffId }] }) as Promise<Types.ObjectId[]>);

registerTimelineSource(async (patientId) => {
  const rows = await AppointmentModel.find({ patientId }).sort({ start: -1 }).limit(50).select('number start status').lean();
  return rows.map((a) => ({ at: a.start, kind: `appointment.${a.status}`, title: a.number, ref: `/clinic/calendar?appointment=${String(a._id)}` }));
});

onBeforeStaffDeactivate(async (staffId) => {
  const count = await svc.futureAppointmentCount(staffId);
  if (count) throw ApiError.conflict('STAFF_HAS_FUTURE_APPOINTMENTS', 'Reassign or cancel future appointments first', { count });
});

registerPath({ method: 'get', path: '/availability', tags: ['scheduling'], summary: 'Free slots (computed on demand)', query: s.availabilityQuery.innerType() });
registerPath({ method: 'get', path: '/appointments', tags: ['scheduling'], summary: 'Calendar range', query: s.listQuery.innerType() });
registerPath({ method: 'post', path: '/appointments', tags: ['scheduling'], summary: 'Book (slot locks, 409 APPOINTMENT_SLOT_TAKEN)', body: s.bookBody });
registerPath({ method: 'patch', path: '/appointments/:id', tags: ['scheduling'], summary: 'Edit / reschedule', params: s.idParams, body: s.updateBody });
registerPath({ method: 'post', path: '/appointments/:id/status', tags: ['scheduling'], summary: 'Status transition', params: s.idParams, body: s.statusBody });
registerPath({ method: 'post', path: '/appointments/bulk-shift', tags: ['scheduling'], summary: 'Shift many appointments', body: s.bulkShiftBody });
registerPath({ method: 'put', path: '/dentist-schedules/:staffId', tags: ['scheduling'], summary: 'Save a weekly schedule version', params: s.staffParams, body: s.scheduleBody });
