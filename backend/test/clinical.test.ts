import { beforeEach, describe, expect, it } from 'vitest';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { syncCatalogs } from '@/modules/clinic/clinic.seeders';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { addDays, atLocal, localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let owner: Session;
let dentist: Session;
let dentist2: Session;
let reception: Session;
let patientId: string;
const proc: Record<string, string> = {};

// 1×1 transparent PNG.
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TZ = 'Asia/Amman';

beforeEach(async () => {
  resetState();
  await syncCatalogs();
  c = await makeClinic('cl');
  owner = await login(c.ownerEmail);
  dentist = await login(c.staff.dentist!.email);
  dentist2 = await login(c.staff.dentist2!.email);
  reception = await login(c.staff.reception!.email);
  const imp = await api(owner).post('/procedures/import-from-catalog').send({ codes: ['D2391', 'D3330', 'D7140', 'D1110', 'D2740'] });
  expect(imp.status).toBeLessThan(300);
  const list = await api(owner).get('/procedures?limit=100');
  for (const p of list.body.data as { code: string; id: string }[]) proc[p.code] = p.id;
  const p = await api(reception).post('/patients').send({ name: { first: 'Omar', family: 'Saleh' }, phone: '0791234500', preferredDentistId: c.staff.dentist!.staffId });
  patientId = p.body.data.id;
});

describe('chart', () => {
  it('adds findings, validates surfaces, voids with a reason', async () => {
    const bad = await api(dentist).post(`/patients/${patientId}/chart/entries`).send({ toothNumber: 11, surfaces: ['O'], kind: 'finding', conditionCode: 'caries' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields[0].code).toBe('invalid_surface');
    const res = await api(dentist).post(`/patients/${patientId}/chart/entries`).send({ toothNumber: 36, surfaces: ['M', 'O'], kind: 'finding', conditionCode: 'caries' });
    expect(res.status).toBe(201);
    expect(res.body.data.teeth['36'].conditions[0]).toMatchObject({ code: 'caries', surfaces: ['M', 'O'], kind: 'finding' });
    const entryId = res.body.data.entries[0].id;
    const voided = await api(dentist).post(`/patients/${patientId}/chart/entries/${entryId}/void`).send({ reason: 'wrong tooth' });
    expect(voided.body.data.teeth['36'].conditions).toHaveLength(0);
    expect(voided.body.data.entries.find((e: { id: string }) => e.id === entryId).voided).toBe(true);
  });

  it('receptionists can view but not edit the chart', async () => {
    expect((await api(reception).get(`/patients/${patientId}/chart`)).status).toBe(200);
    expect((await api(reception).post(`/patients/${patientId}/chart/entries`).send({ toothNumber: 36, kind: 'finding', conditionCode: 'caries' })).status).toBe(403);
  });
});

describe('plans created by the owner (not a dentist)', () => {
  it('asks for the dentist instead of refusing the owner, then books with the chosen dentist', async () => {
    const item = { clinicProcedureId: proc.D2391, toothNumbers: [46], surfaces: ['M', 'O'] };
    const missing = await api(owner).post('/treatment-plans').send({ patientId, items: [item] });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.fields[0]).toMatchObject({ path: 'dentistId', code: 'required' });
    // Naming a non-dentist explicitly is still refused.
    const ownerAsDentist = await api(owner).post('/treatment-plans').send({ patientId, dentistId: c.staff.owner!.staffId, items: [item] });
    expect(ownerAsDentist.body.error.code).toBe('DENTIST_NOT_BOOKABLE');

    const plan = await api(owner).post('/treatment-plans').send({ patientId, dentistId: c.staff.dentist!.staffId, items: [item] });
    expect(plan.status).toBe(201);
    expect(plan.body.data.dentistId).toBe(c.staff.dentist!.staffId);
    const start = atLocal(addDays(localDate(new Date(), TZ), 1), '10:00', TZ).toISOString();
    const booked = await api(owner).post('/appointments').send({ patientId, dentistId: plan.body.data.dentistId, start, durationMin: 30, source: 'staff', priority: 'normal', override: true });
    expect(booked.status).toBe(201);
  });
});

describe('end to end: finding → plan → accept → book → perform → chart', () => {
  it('runs the whole flow', async () => {
    await api(dentist).post(`/patients/${patientId}/chart/entries`).send({ toothNumber: 46, surfaces: ['M', 'O'], kind: 'finding', conditionCode: 'caries' });

    const plan = await api(dentist)
      .post('/treatment-plans')
      .send({ patientId, title: 'Lower right', items: [{ clinicProcedureId: proc.D2391, toothNumbers: [46], surfaces: ['M', 'O'] }, { clinicProcedureId: proc.D3330, toothNumbers: [46] }] });
    expect(plan.status).toBe(201);
    expect(plan.body.data.number).toMatch(/^TP-/);
    expect(plan.body.data.totals.gross).toBeGreaterThan(0);
    const chart1 = await api(dentist).get(`/patients/${patientId}/chart`);
    expect(chart1.body.data.teeth['46'].conditions.filter((x: { kind: string }) => x.kind === 'planned')).toHaveLength(2);

    // Price override needs discount rights.
    const override = await api(dentist).patch(`/treatment-plans/${plan.body.data.id}`).send({ items: [{ clinicProcedureId: proc.D2391, toothNumbers: [46], surfaces: ['M', 'O'], unitPrice: 1 }] });
    expect(override.status).toBe(403);

    const presented = await api(dentist).post(`/treatment-plans/${plan.body.data.id}/present`).send({});
    expect(presented.body.data.status).toBe('presented');
    expect((await api(dentist).patch(`/treatment-plans/${plan.body.data.id}`).send({ title: 'x' })).body.error.code).toBe('PLAN_NOT_EDITABLE');

    const fillingItem = presented.body.data.items[0].id;
    const accepted = await api(dentist).post(`/treatment-plans/${plan.body.data.id}/accept`).send({ itemIds: [fillingItem], signature: SIGNATURE, signerName: 'Omar Saleh' });
    expect(accepted.body.error).toBeUndefined();
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('partially_accepted');
    expect(accepted.body.data.acceptance.signatureFileId).toBeTruthy();

    // Book the accepted item.
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: c.clinicId }, { $set: { workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '08:00', close: '20:00', closed: false })) } }));
    const tomorrow = addDays(localDate(new Date(), TZ), 1);
    await api(owner).put(`/dentist-schedules/${c.staff.dentist!.staffId}`).send({ effectiveFrom: localDate(new Date(), TZ), weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, blocks: [{ start: '08:00', end: '20:00' }] })) });
    const appt = await api(reception)
      .post('/appointments')
      .send({ patientId, dentistId: c.staff.dentist!.staffId, start: atLocal(tomorrow, '10:00', TZ).toISOString(), durationMin: 45, plannedItems: [{ treatmentPlanItemId: fillingItem }] });
    expect(appt.status).toBe(201);
    expect((await api(dentist).get(`/treatment-plans/${plan.body.data.id}`)).body.data.items[0].status).toBe('scheduled');

    // Perform it.
    const done = await api(dentist).post('/performed-procedures').send({ patientId, appointmentId: appt.body.data.id, treatmentPlanItemId: fillingItem, clinicProcedureId: proc.D2391 });
    expect(done.status).toBe(201);
    expect(done.body.data.toothNumbers).toEqual([46]);
    const after = await api(dentist).get(`/treatment-plans/${plan.body.data.id}`);
    expect(after.body.data.items[0].status).toBe('completed');
    expect(after.body.data.status).toBe('completed');
    const chart = await api(dentist).get(`/patients/${patientId}/chart`);
    const conds = chart.body.data.teeth['46'].conditions as { code: string; kind: string }[];
    expect(conds.some((x) => x.kind === 'completed' && x.code === 'filling')).toBe(true);
    expect(conds.some((x) => x.code === 'caries')).toBe(false);

    // The visit can now be completed without a "no procedures" reason.
    const go = (to: string) => api(reception).post(`/appointments/${appt.body.data.id}/status`).send({ to });
    await go('arrived');
    await go('in_chair');
    expect((await api(dentist).post(`/appointments/${appt.body.data.id}/status`).send({ to: 'completed' })).body.data.status).toBe('completed');

    // Void puts the plan item back.
    const voided = await api(dentist).post(`/performed-procedures/${done.body.data.id}/void`).send({ reason: 'recorded twice' });
    expect(voided.body.data.status).toBe('voided');
    expect((await api(dentist).get(`/treatment-plans/${plan.body.data.id}`)).body.data.items[0].status).toBe('accepted');
  });

  it('extraction sets the tooth missing; prophylaxis creates a cleaning recall', async () => {
    await api(dentist).post('/performed-procedures').send({ patientId, clinicProcedureId: proc.D7140, toothNumbers: [18] });
    expect((await api(dentist).get(`/patients/${patientId}/chart`)).body.data.teeth['18'].status).toBe('missing');
    await api(dentist).post('/performed-procedures').send({ patientId, clinicProcedureId: proc.D1110 });
    const recalls = await api(reception).get('/recalls?bucket=all');
    expect(recalls.body.data[0]).toMatchObject({ type: 'cleaning', status: 'upcoming' });
  });

  it('tooth is required when the procedure needs it; dentists record only their own work', async () => {
    expect((await api(dentist).post('/performed-procedures').send({ patientId, clinicProcedureId: proc.D2740 })).body.error.details.fields[0]).toMatchObject({ path: 'toothNumbers', code: 'required' });
    expect((await api(dentist).post('/performed-procedures').send({ patientId, clinicProcedureId: proc.D2740, toothNumbers: [16], dentistId: c.staff.dentist2!.staffId })).status).toBe(403);
  });

  it('own-scope plans are invisible to other dentists', async () => {
    const plan = await api(dentist).post('/treatment-plans').send({ patientId, items: [{ clinicProcedureId: proc.D2740, toothNumbers: [16] }] });
    expect((await api(dentist2).get(`/treatment-plans/${plan.body.data.id}`)).status).toBe(404);
    expect((await api(owner).get(`/treatment-plans/${plan.body.data.id}`)).status).toBe(200);
  });

  it('alternatives: accepting one rejects the sibling', async () => {
    const a = await api(dentist).post('/treatment-plans').send({ patientId, alternativeLabel: 'Crown', items: [{ clinicProcedureId: proc.D2740, toothNumbers: [16] }] });
    const b = await api(dentist).post('/treatment-plans').send({ patientId, alternativeOf: a.body.data.id, alternativeLabel: 'Extraction', items: [{ clinicProcedureId: proc.D7140, toothNumbers: [16] }] });
    expect(b.body.data.alternativeGroupId).toBe(a.body.data.id);
    await api(dentist).post(`/treatment-plans/${a.body.data.id}/present`).send({});
    await api(dentist).post(`/treatment-plans/${a.body.data.id}/accept`).send({ signature: SIGNATURE });
    expect((await api(dentist).get(`/treatment-plans/${b.body.data.id}`)).body.data.status).toBe('rejected');
  });
});

describe('notes, perio, prescriptions, lab orders, consents', () => {
  it('notes: sign locks, amend creates a new version', async () => {
    const n = await api(dentist).post('/notes').send({ patientId, format: 'soap', content: { subjective: 'Pain on 36', assessment: 'Caries' } });
    expect(n.status).toBe(201);
    expect((await api(dentist).post(`/notes/${n.body.data.id}/sign`)).body.data.signedAt).toBeTruthy();
    expect((await api(dentist).patch(`/notes/${n.body.data.id}`).send({ content: { subjective: 'x' } })).body.error.code).toBe('NOTE_SIGNED');
    const am = await api(dentist).post(`/notes/${n.body.data.id}/amend`).send({ content: { subjective: 'Pain on 36, worse at night' } });
    expect(am.body.data.amendsNoteId).toBe(n.body.data.id);
    expect((await api(dentist).get(`/patients/${patientId}/notes`)).body.data).toHaveLength(2);
    expect((await api(dentist2).get(`/patients/${patientId}/notes`)).status).toBe(404);
  });

  it('perio exam computes summary values', async () => {
    const t = { pocketDepth: [3, 4, 6, 2, 2, 3], recession: [1, 0, 0, 0, 0, 0], bleeding: [true, true, false, false, false, false], suppuration: [false, false, false, false, false, false] };
    const res = await api(dentist).post('/perio').send({ patientId, examDate: localDate(new Date(), TZ), teeth: { '16': t } });
    expect(res.status).toBe(201);
    expect(res.body.data.summary).toMatchObject({ sites: 6, sites4mm: 2, sites6mm: 1, bopPercent: 33.3 });
  });

  it('prescriptions are numbered and printable; receptionists cannot write them', async () => {
    const rx = await api(dentist).post('/prescriptions').send({ patientId, items: [{ name: 'Amoxicillin 500 mg', dose: '1 capsule', frequency: '3× daily', durationDays: 7 }] });
    expect(rx.status).toBe(201);
    expect(rx.body.data.number).toMatch(/^RX-\d{4}-/);
    const print = await api(dentist).get(`/prescriptions/${rx.body.data.id}/print`);
    expect(print.body.data.dentist.name).toBe('Dentist One');
    expect((await api(reception).post('/prescriptions').send({ patientId, items: [{ name: 'x' }] })).status).toBe(403);
  });

  it('lab order lifecycle with remake reason', async () => {
    const lab = await api(dentist).post('/lab-orders').send({ patientId, labName: 'Amman Dental Lab', items: [{ type: 'crown', toothNumbers: [16], material: 'Zirconia', shade: 'A2' }], dueDate: addDays(localDate(new Date(), TZ), 7) });
    expect(lab.status).toBe(201);
    const step = (to: string, extra = {}) => api(dentist).post(`/lab-orders/${lab.body.data.id}/status`).send({ to, ...extra });
    expect((await step('fitted')).body.error.code).toBe('INVALID_STATE_TRANSITION');
    await step('sent');
    expect((await step('received', { cost: 45000 })).body.data.cost).toBe(45000);
    expect((await step('remake')).status).toBe(422);
    expect((await step('remake', { reason: 'shade' })).body.data.status).toBe('remake');
  });

  it('consent renders placeholders and stores the signature', async () => {
    const tpl = await api(owner).post('/consent-templates').send({ title: 'Extraction consent', body: 'I, {{patient.name}}, agree to {{procedure}} on {{date}}.', procedureCategories: ['oral_surgery'] });
    expect(tpl.status).toBe(201);
    const res = await api(dentist).post('/consents').send({ patientId, templateId: tpl.body.data.id, values: { procedure: 'extraction of 18' }, signature: SIGNATURE });
    expect(res.status).toBe(201);
    expect(res.body.data.renderedBody).toMatch(/^I, Omar Saleh, agree to extraction of 18 on \d{4}-\d{2}-\d{2}\.$/);
  });
});
