import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { AttendanceModel } from '@/modules/hr/hr.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { addDays, localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let owner: Session;
let hrUser: Session;
let dentist: Session;
let reception: Session;
const TZ = 'Asia/Amman';
const today = () => localDate(new Date(), TZ);

beforeEach(async () => {
  resetState();
  c = await makeClinic('hr');
  owner = await login(c.ownerEmail);
  hrUser = await login(c.staff.hr!.email);
  dentist = await login(c.staff.dentist!.email);
  reception = await login(c.staff.reception!.email);
});

const typeId = async (code: string, s = dentist) => ((await api(s).get('/leave-types')).body.data as { id: string; code: string }[]).find((t) => t.code === code)!.id;

/** Next Sunday on or after `from` (Friday is the seeded weekend). */
function nextSunday(from: string) {
  let d = from;
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0) d = addDays(d, 1);
  return d;
}

describe('leave', () => {
  it('counts working days only (weekend and holidays excluded) and reserves balance', async () => {
    const sun = nextSunday(addDays(today(), 7));
    // Sun → next Sun = 8 calendar days, 1 Friday → 7 working days; a holiday on Tuesday → 6.
    await api(owner).post('/schedule-exceptions').send({ type: 'holiday', start: new Date(`${addDays(sun, 2)}T00:00:00+03:00`).toISOString(), end: new Date(`${addDays(sun, 3)}T00:00:00+03:00`).toISOString(), reason: 'Holiday' });
    const req = await api(reception).post('/leave-requests').send({ leaveTypeId: await typeId('annual', reception), startDate: sun, endDate: addDays(sun, 7) });
    expect(req.status).toBe(201);
    expect(req.body.data.days).toBe(6);
    const bal = (await api(reception).get('/leave-balances')).body.data.find((b: { code: string }) => b.code === 'annual');
    expect(bal).toMatchObject({ entitled: 14, pending: 6, remaining: 8 });
    const overlap = await api(reception).post('/leave-requests').send({ leaveTypeId: await typeId('annual', reception), startDate: addDays(sun, 1), endDate: addDays(sun, 2) });
    expect(overlap.body.error.code).toBe('LEAVE_OVERLAP');
    const tooMuch = await api(reception).post('/leave-requests').send({ leaveTypeId: await typeId('annual', reception), startDate: addDays(sun, 14), endDate: addDays(sun, 30) });
    expect(tooMuch.body.error.code).toBe('LEAVE_INSUFFICIENT_BALANCE');
    const unpaid = await api(reception).post('/leave-requests').send({ leaveTypeId: await typeId('unpaid', reception), startDate: addDays(sun, 14), endDate: addDays(sun, 30) });
    expect(unpaid.status).toBe(201);
  });

  it('approval moves pending → taken and blocks the dentist calendar', async () => {
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: c.clinicId }, { $set: { workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '08:00', close: '20:00', closed: false })) } }));
    const sun = nextSunday(addDays(today(), 3));
    await api(owner).put(`/dentist-schedules/${c.staff.dentist!.staffId}`).send({ effectiveFrom: today(), weekly: [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, blocks: [{ start: '09:00', end: '17:00' }] })) });
    const before = await api(reception).get(`/availability?from=${sun}&to=${sun}&dentistId=${c.staff.dentist!.staffId}`);
    expect(before.body.data.days[0].slots.length).toBeGreaterThan(0);
    const req = await api(dentist).post('/leave-requests').send({ leaveTypeId: await typeId('annual'), startDate: sun, endDate: sun });
    expect((await api(dentist).post(`/leave-requests/${req.body.data.id}/approve`).send({})).status).toBe(403);
    const ok = await api(hrUser).post(`/leave-requests/${req.body.data.id}/approve`).send({});
    expect(ok.body.data.status).toBe('approved');
    const after = await api(reception).get(`/availability?from=${sun}&to=${sun}&dentistId=${c.staff.dentist!.staffId}`);
    expect(after.body.data.days[0].slots).toHaveLength(0);
    const bal = (await api(dentist).get('/leave-balances')).body.data.find((b: { code: string }) => b.code === 'annual');
    expect(bal).toMatchObject({ taken: 1, pending: 0 });
    // Cancelling gives the day back and frees the calendar.
    await api(hrUser).post(`/leave-requests/${req.body.data.id}/cancel`);
    expect((await api(reception).get(`/availability?from=${sun}&to=${sun}&dentistId=${c.staff.dentist!.staffId}`)).body.data.days[0].slots.length).toBeGreaterThan(0);
  });
});

describe('attendance', () => {
  it('check in / out once per day; HR adjustments need a reason', async () => {
    const a = await api(reception).post('/attendance/check-in').send({});
    expect(a.status).toBe(200);
    expect((await api(reception).post('/attendance/check-in').send({})).body.error.code).toBe('ALREADY_CHECKED_IN');
    expect((await api(reception).post('/attendance/check-out').send({})).body.data.checkOut).toBeTruthy();
    const mine = await api(reception).get(`/attendance?from=${today()}&to=${today()}`);
    expect(mine.body.data).toHaveLength(1);
    expect((await api(hrUser).post('/attendance/adjust').send({ staffId: c.staff.reception!.staffId, date: today(), checkIn: '09:00' })).status).toBe(422);
    const adj = await api(hrUser).post('/attendance/adjust').send({ staffId: c.staff.reception!.staffId, date: today(), checkIn: '09:00', checkOut: '17:00', reason: 'Forgot to punch' });
    expect(adj.body.data.workedMinutes).toBe(450);
  });

  it('QR check-in uses the rotating token', async () => {
    const qr = await api(hrUser).get('/attendance/qr');
    expect((await api(reception).post('/attendance/qr').send({ token: 'bad.token', kind: 'in' })).status).toBe(422);
    expect((await api(reception).post('/attendance/qr').send({ token: qr.body.data.token, kind: 'in' })).body.data.checkIn.method).toBe('qr');
  });
});

describe('payroll', () => {
  it('calculates, approves with a balanced journal, locks attendance, then pays', async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    await api(reception).post('/attendance/check-in').send({});
    const run = await api(hrUser).post('/payroll-runs').send({ year, month });
    expect(run.status).toBe(201);
    expect((await api(hrUser).post('/payroll-runs').send({ year, month })).body.error.code).toBe('PAYROLL_EXISTS');
    const calc = await api(hrUser).post(`/payroll-runs/${run.body.data.id}/calculate`);
    expect(calc.body.data.status).toBe('calculated');
    expect(calc.body.data.payslips.length).toBeGreaterThanOrEqual(5);
    const withBonus = await api(hrUser).post(`/payroll-runs/${run.body.data.id}/lines`).send({ staffId: c.staff.reception!.staffId, kind: 'earning', name: 'Bonus', amount: 25_000, reason: 'Great month' });
    expect(withBonus.body.data.totals.gross).toBe(calc.body.data.totals.gross + 25_000);

    const approved = await api(owner).post(`/payroll-runs/${run.body.data.id}/approve`);
    expect(approved.body.data.status).toBe('approved');
    expect((await api(owner).post(`/payroll-runs/${run.body.data.id}/approve`)).body.error.code).toBe('INVALID_STATE_TRANSITION');
    const tb = await api(owner).get('/reports/trial-balance');
    expect(tb.body.data.balanced).toBe(true);
    const locked = await runInTenant(c.clinicId, () => AttendanceModel.findOne({ staffId: c.staff.reception!.staffId }).lean());
    expect(locked?.payrollRunId).toBeTruthy();
    expect((await api(hrUser).post('/attendance/adjust').send({ staffId: c.staff.reception!.staffId, date: today(), status: 'absent', reason: 'x' })).body.error.code).toBe('ATTENDANCE_LOCKED');

    const bank = ((await api(owner).get('/accounts')).body.data as { id: string; systemKey?: string }[]).find((a) => a.systemKey === 'BANK_DEFAULT')!;
    expect((await api(owner).post(`/payroll-runs/${run.body.data.id}/pay`).send({ paidFromAccountId: bank.id })).body.data.status).toBe('paid');
    expect((await api(owner).get('/reports/trial-balance')).body.data.balanced).toBe(true);

    // Staff see only their own final payslip, and acknowledge it.
    const mine = await api(reception).get('/payslips/mine');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].net).toBeGreaterThan(0);
    const other = approved.body.data.payslips.find((p: { staffId: string }) => p.staffId === c.staff.dentist!.staffId);
    expect((await api(reception).get(`/payslips/${other.id}`)).status).toBe(404);
    expect((await api(reception).post(`/payslips/${mine.body.data[0].id}/acknowledge`)).body.data.acknowledgedAt).toBeTruthy();
  });
});
