import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { TRANSITIONS } from '@/modules/scheduling/appointment.state';
import { APPOINTMENT_STATUSES, AppointmentModel, SlotLockModel } from '@/modules/scheduling/scheduling.models';
import { addDays, atLocal, localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let owner: Session;
let reception: Session;
let dentist: Session;
let patientId: string;

const TZ = 'Asia/Amman';
const tomorrow = () => addDays(localDate(new Date(), TZ), 1);
const at = (time: string, date = tomorrow()) => atLocal(date, time, TZ).toISOString();
const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, blocks: [{ start: '08:00', end: '20:00' }] }));

beforeEach(async () => {
  resetState();
  c = await makeClinic('sch');
  await runWithoutTenant(() => ClinicModel.updateOne({ _id: c.clinicId }, { $set: { workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '08:00', close: '20:00', closed: false })) } }));
  owner = await login(c.ownerEmail);
  reception = await login(c.staff.reception!.email);
  dentist = await login(c.staff.dentist!.email);
  for (const key of ['dentist', 'dentist2'] as const) {
    const r = await api(owner).put(`/dentist-schedules/${c.staff[key]!.staffId}`).send({ effectiveFrom: addDays(tomorrow(), -10), slotGranularityMin: 15, weekly: ALL_DAY });
    expect(r.status).toBe(200);
  }
  const p = await api(reception).post('/patients').send({ name: { first: 'Lina', family: 'Haddad' }, phone: '0791234567', gender: 'female', dateOfBirth: '1990-04-12' });
  patientId = p.body.data.id;
});

const bookBody = (over: Record<string, unknown> = {}) => ({ patientId, dentistId: c.staff.dentist!.staffId, start: at('10:00'), durationMin: 30, ...over });

describe('availability', () => {
  it('returns slots from the weekly schedule and hides booked time', async () => {
    const before = await api(reception).get(`/availability?from=${tomorrow()}&to=${tomorrow()}&dentistId=${c.staff.dentist!.staffId}&durationMin=30`);
    expect(before.status).toBe(200);
    const starts = before.body.data.days[0].slots.map((s: { start: string }) => s.start);
    expect(starts).toContain(at('10:00'));
    await api(reception).post('/appointments').send(bookBody());
    const after = await api(reception).get(`/availability?from=${tomorrow()}&to=${tomorrow()}&dentistId=${c.staff.dentist!.staffId}&durationMin=30`);
    const later = after.body.data.days[0].slots.map((s: { start: string }) => s.start);
    expect(later).not.toContain(at('10:00'));
    expect(later).not.toContain(at('10:15'));
    expect(later).toContain(at('10:30'));
  });

  it('rejects ranges longer than 42 days', async () => {
    const res = await api(reception).get(`/availability?from=${tomorrow()}&to=${addDays(tomorrow(), 60)}`);
    expect(res.status).toBe(422);
  });
});

describe('booking', () => {
  it('books, numbers and writes 5-minute locks for dentist and chair', async () => {
    const res = await api(reception).post('/appointments').send(bookBody());
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe('APT-000001');
    expect(res.body.data.status).toBe('scheduled');
    expect(res.body.data.patient.fullName).toBe('Lina Haddad');
    const locks = await runInTenant(c.clinicId, () => SlotLockModel.countDocuments({ appointmentId: res.body.data.id }));
    expect(locks).toBe(6);
  });

  it('20 parallel bookings of the same slot: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => api(reception).post('/appointments').send(bookBody())));
    const codes = results.map((r) => r.status);
    expect(codes.filter((s) => s === 201)).toHaveLength(1);
    expect(codes.filter((s) => s === 409)).toHaveLength(19);
    for (const r of results.filter((x) => x.status === 409)) expect(['APPOINTMENT_SLOT_TAKEN', 'APPOINTMENT_OUTSIDE_SCHEDULE']).toContain(r.body.error.code);
    expect(await runInTenant(c.clinicId, () => AppointmentModel.countDocuments({}))).toBe(1);
  });

  it('rejects times outside the schedule, off the grid and in the past', async () => {
    expect((await api(reception).post('/appointments').send(bookBody({ start: at('21:00') }))).body.error.code).toBe('APPOINTMENT_OUTSIDE_SCHEDULE');
    expect((await api(reception).post('/appointments').send(bookBody({ start: at('10:07') }))).body.error.code).toBe('APPOINTMENT_NOT_ALIGNED');
    expect((await api(reception).post('/appointments').send(bookBody({ start: new Date(Date.now() - 3_600_000).toISOString() }))).body.error.code).toBe('APPOINTMENT_IN_PAST');
  });

  it('override books outside the schedule (full scope only); allowOverlap double-books', async () => {
    expect((await api(dentist).post('/appointments').send(bookBody({ start: at('21:00'), override: true }))).status).toBe(403);
    expect((await api(reception).post('/appointments').send(bookBody({ start: at('21:00'), override: true }))).status).toBe(201);
    await api(reception).post('/appointments').send(bookBody());
    const overlap = await api(reception).post('/appointments').send(bookBody({ override: true, allowOverlap: true }));
    expect(overlap.status).toBe(201);
    expect(overlap.body.data.overbooked).toBe(true);
  });

  it('a dentist with own scope cannot book into another calendar', async () => {
    const res = await api(dentist).post('/appointments').send(bookBody({ dentistId: c.staff.dentist2!.staffId }));
    expect(res.status).toBe(403);
    expect((await api(dentist).post('/appointments').send(bookBody())).status).toBe(201);
  });

  it('non-clinical staff are not bookable', async () => {
    const res = await api(reception).post('/appointments').send(bookBody({ dentistId: c.staff.reception!.staffId }));
    expect(res.body.error.code).toBe('DENTIST_NOT_BOOKABLE');
  });
});

describe('reschedule and cancel', () => {
  it('reschedule moves the locks', async () => {
    const a = (await api(reception).post('/appointments').send(bookBody())).body.data;
    const moved = await api(reception).patch(`/appointments/${a.id}`).send({ start: at('12:00'), version: a.version });
    expect(moved.status).toBe(200);
    const buckets = await runInTenant(c.clinicId, () => SlotLockModel.find({ appointmentId: a.id, resourceType: 'dentist' }).sort({ bucketStart: 1 }).lean());
    expect(buckets[0]!.bucketStart.toISOString()).toBe(at('12:00'));
    // The old time is free again.
    expect((await api(reception).post('/appointments').send(bookBody())).status).toBe(201);
    // Stale version → 409.
    expect((await api(reception).patch(`/appointments/${a.id}`).send({ start: at('13:00'), version: 0 })).body.error.code).toBe('VERSION_CONFLICT');
  });

  it('cancel releases the locks and flags late cancels', async () => {
    // Tomorrow 10:00 is always within a 72 h window, whatever the time of day the test runs.
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: c.clinicId }, { $set: { 'settings.cancellationWindowHours': 72 } }));
    const a = (await api(reception).post('/appointments').send(bookBody())).body.data;
    const res = await api(reception).post(`/appointments/${a.id}/cancel`).send({ reason: 'patient_request' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(res.body.data.cancellation.lateCancel).toBe(true);
    expect(await runInTenant(c.clinicId, () => SlotLockModel.countDocuments({ appointmentId: a.id }))).toBe(0);
    expect((await api(reception).post('/appointments').send(bookBody())).status).toBe(201);
  });

  it('bulk shift moves several appointments', async () => {
    const a = (await api(reception).post('/appointments').send(bookBody())).body.data;
    const b = (await api(reception).post('/appointments').send(bookBody({ start: at('11:00') }))).body.data;
    const res = await api(reception).post('/appointments/bulk-shift').send({ ids: [a.id, b.id], minutes: 30 });
    expect(res.body.data.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect((await api(reception).get(`/appointments/${a.id}`)).body.data.start).toBe(at('10:30'));
  });
});

describe('state machine', () => {
  it('the transition table covers every status', () => {
    for (const s of APPOINTMENT_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
    expect(TRANSITIONS.completed).toEqual([]);
  });

  it('walks scheduled → confirmed → arrived → in_chair → completed and rejects invalid jumps', async () => {
    const a = (await api(reception).post('/appointments').send(bookBody())).body.data;
    const go = (to: string, extra: Record<string, unknown> = {}) => api(reception).post(`/appointments/${a.id}/status`).send({ to, ...extra });
    expect((await go('in_chair')).body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await go('confirmed')).status).toBe(200);
    expect((await go('arrived')).body.data.checkInAt).toBeTruthy();
    expect((await go('in_chair')).body.data.seatedAt).toBeTruthy();
    expect((await go('cancelled', { reason: 'x' })).body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await go('completed')).body.error.code).toBe('COMPLETE_REQUIRES_PROCEDURE');
    const done = await go('completed', { noProcedures: true, reason: 'consultation only' });
    expect(done.body.data.status).toBe('completed');
    expect(done.body.data.statusHistory.map((h: { to: string }) => h.to)).toEqual(['scheduled', 'confirmed', 'arrived', 'in_chair', 'completed']);
    expect((await go('scheduled')).body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('no-show only after the grace period, and counts on the patient', async () => {
    const early = (await api(owner).post('/appointments').send(bookBody({ start: new Date(Math.floor((Date.now() - 5 * 60_000) / 300_000) * 300_000).toISOString(), override: true }))).body.data;
    expect((await api(reception).post(`/appointments/${early.id}/status`).send({ to: 'no_show' })).body.error.code).toBe('NO_SHOW_TOO_EARLY');
    const late = (await api(owner).post('/appointments').send(bookBody({ start: new Date(Math.floor((Date.now() - 60 * 60_000) / 300_000) * 300_000).toISOString(), override: true }))).body.data;
    const res = await api(reception).post(`/appointments/${late.id}/status`).send({ to: 'no_show' });
    expect(res.body.data.status).toBe('no_show');
    expect((await api(reception).get(`/patients/${patientId}`)).body.data.noShowCount).toBe(1);
  });
});

describe('today board, scope and schedules', () => {
  it('groups today by column', async () => {
    const date = tomorrow();
    await api(reception).post('/appointments').send(bookBody());
    const board = await api(reception).get(`/appointments/today-board?date=${date}`);
    expect(board.body.data.upcoming).toHaveLength(1);
    expect(board.body.data.counts.scheduled).toBe(1);
  });

  it('a dentist with own scope only lists their own appointments; others are 404', async () => {
    const mine = (await api(reception).post('/appointments').send(bookBody())).body.data;
    const other = (await api(reception).post('/appointments').send(bookBody({ dentistId: c.staff.dentist2!.staffId }))).body.data;
    const list = await api(dentist).get(`/appointments?from=${tomorrow()}&to=${tomorrow()}`);
    expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([mine.id]);
    expect((await api(dentist).get(`/appointments/${other.id}`)).status).toBe(404);
  });

  it('rejects overlapping blocks and blocks deactivating a dentist with future appointments', async () => {
    const bad = await api(owner).put(`/dentist-schedules/${c.staff.dentist!.staffId}`).send({ effectiveFrom: tomorrow(), weekly: [{ weekday: 1, blocks: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields[0].code).toBe('overlap');
    await api(reception).post('/appointments').send(bookBody());
    const deact = await api(owner).post(`/staff/${c.staff.dentist!.staffId}/deactivate`).send({ status: 'inactive' });
    expect(deact.body.error.code).toBe('STAFF_HAS_FUTURE_APPOINTMENTS');
  });

  it('time off removes availability', async () => {
    const ex = await api(owner).post('/schedule-exceptions').send({ type: 'time_off', staffId: c.staff.dentist!.staffId, start: at('08:00'), end: at('20:00'), reason: 'vacation' });
    expect(ex.status).toBe(201);
    const res = await api(reception).get(`/availability?from=${tomorrow()}&to=${tomorrow()}&dentistId=${c.staff.dentist!.staffId}`);
    expect(res.body.data.days[0].slots).toHaveLength(0);
  });

  it('waiting list and recalls', async () => {
    const w = await api(reception).post('/waiting-list').send({ patientId, preferredDays: [1, 2], priority: 'high' });
    expect(w.status).toBe(201);
    expect((await api(reception).get('/waiting-list')).body.data[0].patient.fullName).toBe('Lina Haddad');
    const r = await api(reception).post('/recalls').send({ patientId, type: 'cleaning', dueDate: addDays(tomorrow(), 3) });
    expect(r.status).toBe(201);
    expect((await api(reception).get('/recalls?bucket=due')).body.data).toHaveLength(1);
    const booked = await api(reception).post('/appointments').send(bookBody({ source: 'recall', recallId: r.body.data.id }));
    expect(booked.status).toBe(201);
    expect((await api(reception).get('/recalls?bucket=booked')).body.data).toHaveLength(1);
  });
});
