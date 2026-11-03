import { beforeEach, describe, expect, it } from 'vitest';
import { MedicineModel } from '@/modules/catalog/catalog.models';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Phase 3b slice 2: structured medications, surgeries, lifestyle and pregnancy weeks (03 §4). */
useTestDb();
let c: TestClinic;
let reception: Session;
let patientId: string;

beforeEach(async () => {
  resetState();
  c = await makeClinic('mh');
  reception = await login(c.staff.reception!.email);
  const p = await api(reception).post('/patients').send({ name: { first: 'Rana', family: 'Saleh' }, phone: '0791234560', gender: 'female' });
  patientId = p.body.data.id;
});

const save = (body: Record<string, unknown>, s = reception) => api(s).post(`/patients/${patientId}/medical-history`).send(body);

describe('richer medical history', () => {
  it('stores medicines, surgeries, lifestyle and pregnancy weeks in a new version', async () => {
    const med = await MedicineModel.create({ name: 'Warfarin 5mg', searchName: 'warfarin 5mg' });
    const res = await save({
      conditions: ['pregnancy', 'anticoagulants'],
      medicationsList: [
        { name: 'Warfarin 5mg', medicineId: String(med._id), dose: '5 mg', frequency: 'once daily', since: '2024-03-01' },
        { name: 'Vitamin D' },
      ],
      medications: 'Herbal tea occasionally',
      surgeries: [{ name: 'Appendectomy', year: 2015, note: 'No complications' }],
      lifestyle: { smoking: 'former', alcohol: 'none' },
      pregnancyWeeks: 20,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      version: 1,
      medicationsList: [{ name: 'Warfarin 5mg', medicineId: String(med._id), dose: '5 mg' }, { name: 'Vitamin D' }],
      medications: 'Herbal tea occasionally',
      surgeries: [{ name: 'Appendectomy', year: 2015 }],
      lifestyle: { smoking: 'former', alcohol: 'none' },
      pregnancyWeeks: 20,
    });
    expect(res.body.data).not.toHaveProperty('answers');

    // A later version without them keeps the old one intact in the history.
    await save({ conditions: [] });
    const versions = await api(reception).get(`/patients/${patientId}/medical-history/versions`);
    expect(versions.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.body.data[0].medicationsList).toEqual([]);
    expect(versions.body.data[1].surgeries).toHaveLength(1);
  });

  it('validates like the editor', async () => {
    const weeksWithoutPregnancy = await save({ conditions: [], pregnancyWeeks: 12 });
    expect(weeksWithoutPregnancy.status).toBe(422);
    expect(weeksWithoutPregnancy.body.error.details.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'pregnancyWeeks', code: 'pregnancy_required' })]));

    const bad = await save({
      conditions: ['pregnancy'],
      pregnancyWeeks: 43,
      surgeries: [{ name: 'Tonsils', year: new Date().getFullYear() + 1 }],
      medicationsList: [{ name: '' }, { name: 'X', since: '2999-01-01' }],
      lifestyle: { smoking: 'sometimes' },
    });
    expect(bad.status).toBe(422);
    const paths = (bad.body.error.details.fields as { path: string; code: string }[]).map((f) => `${f.path}:${f.code}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'pregnancyWeeks:too_big',
        'surgeries.0.year:date_in_future',
        'medicationsList.0.name:required',
        'medicationsList.1.since:date_in_future',
        'lifestyle.smoking:invalid_option',
      ]),
    );

    const tooMany = await save({ medicationsList: Array.from({ length: 31 }, (_, i) => ({ name: `Med ${i}` })) });
    expect(tooMany.status).toBe(422);

    const ghost = await save({ medicationsList: [{ name: 'Gone', medicineId: '64b000000000000000000001' }] });
    expect(ghost.status).toBe(422);
    expect(ghost.body.error.details.fields[0]).toMatchObject({ path: 'medicationsList.0.medicineId', code: 'not_found' });
  });

  it('lets the history editor search the medicine catalog', async () => {
    await MedicineModel.create({ name: 'Amoxicillin 500mg', searchName: 'amoxicillin 500mg' });
    const res = await api(reception).get('/catalog/medicines?q=amox');
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Amoxicillin 500mg');
    const accountant = await login(c.staff.accountant!.email);
    expect((await api(accountant).get('/catalog/medicines?q=amox')).status).toBe(403);
  });
});
