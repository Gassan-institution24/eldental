import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { InvoiceModel } from '@/modules/billing/billing.models';
import { TreatmentPlanModel } from '@/modules/clinical/clinical.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, atLocal, localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Patient portal (01 §4.10): only the account's own files and dependants, online rules, windows. */

useTestDb();
const TZ = 'Asia/Amman';
const SLUG = 'clinic-po';
const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, blocks: [{ start: '08:00', end: '20:00' }] }));
const inDays = (n: number) => addDays(localDate(new Date(), TZ), n);
const at = (date: string, time: string) => atLocal(date, time, TZ).toISOString();

let c: TestClinic;
let reception: Session;
let examTypeId: string;
let fillingTypeId: string;

async function patientAccount(phone: string, firstName = 'Lina'): Promise<Session> {
  const person = { firstName, lastName: 'Haddad', phone };
  const start = await api().post('/auth/patient/register/start').send(person);
  const done = await api().post('/auth/patient/register').send({ ...person, code: start.body.data.devCode, password: 'MySmile2026' });
  expect(done.status).toBe(200);
  return { token: done.body.data.accessToken, cookie: '', userId: done.body.data.user.id };
}

beforeEach(async () => {
  resetState();
  c = await makeClinic('po');
  await runWithoutTenant(() =>
    ClinicModel.updateOne(
      { _id: c.clinicId },
      { $set: { 'settings.onlineBookingEnabled': true, 'settings.cancellationWindowHours': 24, workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '08:00', close: '20:00', closed: false })) } },
    ),
  );
  const owner = await login(c.ownerEmail);
  reception = await login(c.staff.reception!.email);
  await api(owner).put(`/dentist-schedules/${c.staff.dentist!.staffId}`).send({ effectiveFrom: inDays(-10), slotGranularityMin: 15, weekly: ALL_DAY }).expect(200);
  await runInTenant(c.clinicId, () => StaffModel.updateOne({ _id: c.staff.dentist!.staffId }, { $set: { bookableOnline: true } }));
  const types = (await api(reception).get('/appointment-types')).body.data as { id: string; systemKey?: string }[];
  examTypeId = types.find((t) => t.systemKey === 'exam')!.id;
  fillingTypeId = types.find((t) => t.systemKey === 'filling')!.id;
});

describe('portal: public clinic page', () => {
  it('lists online clinics, online types and bookable dentists, and online slots', async () => {
    expect((await api().get('/portal/clinics')).body.data.map((x: { slug: string }) => x.slug)).toContain(SLUG);
    const page = (await api().get(`/portal/clinics/${SLUG}`)).body.data;
    expect(page.appointmentTypes.map((t: { id: string }) => t.id)).toContain(examTypeId);
    expect(page.appointmentTypes.map((t: { id: string }) => t.id)).not.toContain(fillingTypeId);
    expect(page.dentists).toEqual([expect.objectContaining({ id: c.staff.dentist!.staffId })]);
    const slots = await api().get(`/portal/clinics/${SLUG}/availability?appointmentTypeId=${examTypeId}&from=${inDays(2)}&to=${inDays(2)}`);
    expect(slots.body.data.days[0].slots[0]).toMatchObject({ start: at(inDays(2), '08:00'), dentistId: c.staff.dentist!.staffId });
    // A clinic without online booking is invisible.
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: c.clinicId }, { $set: { 'settings.onlineBookingEnabled': false } }));
    expect((await api().get(`/portal/clinics/${SLUG}`)).status).toBe(404);
  });
});

describe('portal: linking a clinic file and dependants', () => {
  it('links with a code sent to the phone on file; another account cannot take it', async () => {
    const file = (await api(reception).post('/patients').send({ name: { first: 'Lina', family: 'Haddad' }, phone: '0791234567' })).body.data;
    const me = await patientAccount('0791112233');
    const start = await api(me).post('/portal/link-patient/start').send({ clinicSlug: SLUG, fileNumber: file.fileNumber.toLowerCase() });
    expect(start.body.data.phoneHint).toBe('•••• 4567');
    expect((await api(me).post('/portal/link-patient').send({ clinicSlug: SLUG, fileNumber: file.fileNumber, code: '000000' })).status).toBe(422);
    const linked = await api(me).post('/portal/link-patient').send({ clinicSlug: SLUG, fileNumber: file.fileNumber, code: start.body.data.devCode });
    expect(linked.body.data.patients).toEqual([expect.objectContaining({ id: file.id, relation: 'self', clinic: expect.objectContaining({ slug: SLUG }) })]);

    const other = await patientAccount('0791112244', 'Sami');
    const taken = await api(other).post('/portal/link-patient/start').send({ clinicSlug: SLUG, fileNumber: file.fileNumber });
    expect(taken.body.error.code).toBe('PATIENT_ALREADY_LINKED');
    expect((await api(other).post('/portal/link-patient/start').send({ clinicSlug: SLUG, fileNumber: 'P-999999' })).body.error.details.fields[0]).toMatchObject({ path: 'fileNumber', code: 'not_found' });

    const added = await api(me).post('/portal/dependants').send({ guardianPatientId: file.id, first: 'Omar', family: 'Haddad', dateOfBirth: '2016-05-01', gender: 'male' });
    expect(added.status).toBe(201);
    expect(added.body.data.patients.map((p: { relation: string }) => p.relation).sort()).toEqual(['dependant', 'self']);
    // The clinic sees the child with the guardian set.
    const child = added.body.data.patients.find((p: { relation: string }) => p.relation === 'dependant');
    expect((await api(reception).get(`/patients/${child.id}`)).body.data.guardian).toMatchObject({ patientId: file.id });
    // Someone else's file can't be used as a guardian.
    expect((await api(other).post('/portal/dependants').send({ guardianPatientId: file.id, first: 'Ziad', family: 'Nasser', dateOfBirth: '2016-05-01', gender: 'male' })).status).toBe(404);
  });
});

describe('portal: online booking and cancelling', () => {
  it('books an online slot (opening a file on first booking) and cancels before the window', async () => {
    const me = await patientAccount('0791112233');
    const start = at(inDays(3), '10:00');
    const booked = await api(me).post('/portal/appointments').send({ clinicSlug: SLUG, appointmentTypeId: examTypeId, dentistId: c.staff.dentist!.staffId, start, notes: 'Tooth ache' });
    expect(booked.status).toBe(201);
    expect(booked.body.data).toMatchObject({ status: 'scheduled', online: true, canCancel: true, upcoming: true });
    const profile = (await api(me).get('/portal/me')).body.data;
    expect(profile.patients).toHaveLength(1);
    // The clinic sees an online booking with the new file.
    const appt = (await api(reception).get(`/appointments/${booked.body.data.id}`)).body.data;
    expect(appt).toMatchObject({ source: 'online', patientId: profile.patients[0].id });

    // The same slot is gone; non-online types can't be booked.
    expect((await api(me).post('/portal/appointments').send({ clinicSlug: SLUG, appointmentTypeId: examTypeId, dentistId: c.staff.dentist!.staffId, start })).status).toBe(409);
    expect((await api(me).post('/portal/appointments').send({ clinicSlug: SLUG, appointmentTypeId: fillingTypeId, dentistId: c.staff.dentist!.staffId, start: at(inDays(3), '12:00') })).body.error.code).toBe('APPOINTMENT_OUTSIDE_SCHEDULE');

    // Other accounts and staff tokens can't touch it.
    const other = await patientAccount('0791112244', 'Sami');
    expect((await api(other).get('/portal/appointments')).body.data).toEqual([]);
    expect((await api(other).post(`/portal/appointments/${booked.body.data.id}/cancel`).send({})).status).toBe(404);
    expect((await api(reception).get('/portal/appointments')).status).toBe(403);

    const cancelled = await api(me).post(`/portal/appointments/${booked.body.data.id}/cancel`).send({ comment: 'Travelling' });
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', canCancel: false });

    // Inside the clinic's window: no online cancellation.
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: c.clinicId }, { $set: { 'settings.cancellationWindowHours': 1000 } }));
    const soon = await api(me).post('/portal/appointments').send({ clinicSlug: SLUG, appointmentTypeId: examTypeId, dentistId: c.staff.dentist!.staffId, start: at(inDays(4), '10:00') });
    expect(soon.body.data.canCancel).toBe(false);
    expect((await api(me).post(`/portal/appointments/${soon.body.data.id}/cancel`).send({})).body.error.code).toBe('CANCEL_WINDOW_PASSED');
  });
});

describe('portal: plans and invoices', () => {
  it('shows presented plans (not drafts), accepts with a signature, and lists issued invoices only', async () => {
    const me = await patientAccount('0791112233');
    await api(me).post('/portal/appointments').send({ clinicSlug: SLUG, appointmentTypeId: examTypeId, dentistId: c.staff.dentist!.staffId, start: at(inDays(3), '10:00') });
    const patientId = (await api(me).get('/portal/me')).body.data.patients[0].id as string;
    const item = { _id: new Types.ObjectId(), clinicProcedureId: new Types.ObjectId(), code: 'D2391', toothNumbers: [36], patientEstimate: 35_000 };
    const [presented, draft] = await runInTenant(c.clinicId, () =>
      Promise.all([
        TreatmentPlanModel.create({ patientId, dentistId: c.staff.dentist!.staffId, number: 'TP-1', status: 'presented', items: [item], totals: { gross: 35_000, discount: 0, insurance: 0, patient: 35_000 } }),
        TreatmentPlanModel.create({ patientId, dentistId: c.staff.dentist!.staffId, number: 'TP-2', status: 'draft', items: [] }),
        InvoiceModel.create({ patientId, number: 'INV-1', status: 'issued', total: 35_000, patientTotal: 35_000, issueDate: inDays(0) }),
        InvoiceModel.create({ patientId, status: 'draft', total: 10_000 }),
      ]),
    );
    const list = (await api(me).get('/portal/treatment-plans')).body.data;
    expect(list.map((p: { id: string }) => p.id)).toEqual([String(presented._id)]);
    expect(list[0]).toMatchObject({ canAccept: true, items: [expect.objectContaining({ code: 'D2391', patientEstimate: 35_000 })] });
    expect((await api(me).post(`/portal/treatment-plans/${String(draft._id)}/accept`).send({ signature: 'data:image/png;base64,iVBORw0KGgo=', signerName: 'Lina Haddad' })).status).toBe(404);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const accepted = await api(me).post(`/portal/treatment-plans/${String(presented._id)}/accept`).send({ signature: png, signerName: 'Lina Haddad' });
    expect(accepted.body.data).toMatchObject({ status: 'accepted', canAccept: false, acceptance: expect.objectContaining({ signerName: 'Lina Haddad' }) });

    const bills = (await api(me).get('/portal/billing')).body.data;
    expect(bills.invoices).toEqual([expect.objectContaining({ number: 'INV-1', patientDue: 35_000 })]);
    const printed = await api(me).get(`/portal/invoices/${bills.invoices[0].id}/print`);
    expect(printed.body.data.invoice.number).toBe('INV-1');
    const other = await patientAccount('0791112244', 'Sami');
    expect((await api(other).get(`/portal/invoices/${bills.invoices[0].id}/print`)).status).toBe(404);
  });
});
