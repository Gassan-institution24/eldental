import { beforeEach, describe, expect, it } from 'vitest';
import { syncCatalogs } from '@/modules/clinic/clinic.seeders';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let owner: Session;

beforeEach(async () => {
  resetState();
  c = await makeClinic('cs');
  owner = await login(c.ownerEmail);
});

describe('clinic profile & hours', () => {
  it('reads and updates with optimistic concurrency', async () => {
    const g = await api(owner).get('/clinic');
    expect(g.body.data.workingHours).toHaveLength(7);
    const p = await api(owner).patch('/clinic').send({ version: g.body.data.version, name: 'Smile Dental Center', settings: { cancellationWindowHours: 12 } });
    expect(p.status).toBe(200);
    expect(p.body.data.settings.cancellationWindowHours).toBe(12);
    const stale = await api(owner).patch('/clinic').send({ version: g.body.data.version, name: 'Again' });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('rejects hours where close is before open', async () => {
    const g = await api(owner).get('/clinic');
    const hours = g.body.data.workingHours.map((h: { weekday: number }) => ({ weekday: h.weekday, open: '09:00', close: '17:00', closed: false }));
    hours[0].close = '08:00';
    const res = await api(owner).patch('/clinic').send({ version: g.body.data.version, workingHours: hours });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields[0]).toMatchObject({ path: 'workingHours.0.close', code: 'end_before_start' });
  });

  it('JoFotara secret is write-only', async () => {
    const res = await api(owner).put('/clinic/integrations/jofotara').send({ enabled: true, clientId: 'abc', secretKey: 'super-secret-key' });
    expect(res.status).toBe(200);
    expect(res.body.data.jofotara.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-key');
  });

  it('receptionist can read but not update settings', async () => {
    const r = await login(c.staff.reception!.email);
    expect((await api(r).get('/clinic')).status).toBe(200);
    expect((await api(r).patch('/clinic').send({ version: 0, name: 'X' })).status).toBe(403);
  });
});

describe('chairs, appointment types, procedures', () => {
  it('chair CRUD with soft delete and restore', async () => {
    const created = await api(owner).post('/chairs').send({ name: 'Chair 1', color: '#4F46E5' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const upd = await api(owner).patch(`/chairs/${id}`).send({ version: 0, roomName: 'Room A' });
    expect(upd.body.data.roomName).toBe('Room A');
    expect((await api(owner).delete(`/chairs/${id}`)).status).toBe(204);
    expect((await api(owner).get('/chairs')).body.data).toHaveLength(0);
    expect((await api(owner).post(`/chairs/${id}/restore`)).status).toBe(200);
    expect((await api(owner).get('/chairs')).body.data).toHaveLength(1);
  });

  it('validates colour and name', async () => {
    const res = await api(owner).post('/chairs').send({ name: '', color: 'blue' });
    const codes = res.body.error.details.fields.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['required', 'invalid_color']));
  });

  it('new clinics get default appointment types and tax rates', async () => {
    const types = await api(owner).get('/appointment-types');
    expect(types.body.data.length).toBeGreaterThanOrEqual(8);
    expect(types.body.data[0].systemKey).toBeTruthy();
    const taxes = await api(owner).get('/tax-rates');
    expect(taxes.body.data.some((t: { isDefault: boolean }) => t.isDefault)).toBe(true);
  });

  it('imports procedures from the catalog and skips duplicates', async () => {
    await syncCatalogs();
    const first = await api(owner).post('/procedures/import-from-catalog').send({ codes: ['D1110', 'D2740', 'D7140'], priceFactorPercent: 120 });
    expect(first.body.data).toEqual({ imported: 3, skipped: 0 });
    const again = await api(owner).post('/procedures/import-from-catalog').send({ codes: ['D1110'] });
    expect(again.body.data).toEqual({ imported: 0, skipped: 1 });
    const list = await api(owner).get('/procedures?sort=code');
    expect(list.body.meta.total).toBe(3);
    const crown = list.body.data.find((p: { code: string }) => p.code === 'D2740');
    expect(crown.price).toBe(240000);
    expect(crown.chartEffect.addCondition).toBe('crown');
  });

  it('procedure prices are integer minor units', async () => {
    const res = await api(owner).post('/procedures').send({ code: 'X1', name: 'Whitening kit', category: 'cosmetic', price: 12.5 });
    expect(res.body.error.details.fields[0]).toMatchObject({ path: 'price', code: 'too_many_decimals' });
  });
});
