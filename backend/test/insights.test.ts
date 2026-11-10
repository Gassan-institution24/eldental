import { beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let owner: Session;
let reception: Session;
let dentist: Session;
const today = () => localDate(new Date(), 'Asia/Amman');

beforeEach(async () => {
  resetState();
  c = await makeClinic('ins');
  owner = await login(c.ownerEmail);
  reception = await login(c.staff.reception!.email);
  dentist = await login(c.staff.dentist!.email);
});

describe('dashboard', () => {
  it('shows sections by permission', async () => {
    const own = await api(owner).get('/dashboard');
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveProperty('today');
    expect(own.body.data).toHaveProperty('collections');
    expect(own.body.data).toHaveProperty('receivables');
    const d = await api(dentist).get('/dashboard');
    expect(d.body.data).toHaveProperty('today');
    expect(d.body.data).not.toHaveProperty('collections');
  });

  it('operational report responds for the range', async () => {
    const r = await api(owner).get(`/reports/operational?from=${today()}&to=${today()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 0, newPatients: 0 });
  });
});

describe('notifications', () => {
  it('approvers hear about leave requests and can mark them read', async () => {
    const types = (await api(reception).get('/leave-types')).body.data as { id: string; code: string }[];
    await api(reception).post('/leave-requests').send({ leaveTypeId: types.find((x) => x.code === 'unpaid')!.id, startDate: today(), endDate: today() });
    const hr = await login(c.staff.hr!.email);
    const list = await api(hr).get('/notifications');
    expect(list.body.data.unread).toBe(1);
    expect(list.body.data.items[0]).toMatchObject({ type: 'leave_requested', titleKey: 'notifications:types.leave_requested' });
    await api(hr).post('/notifications/read-all');
    expect((await api(hr).get('/notifications')).body.data.unread).toBe(0);
    expect((await api(reception).get('/notifications')).body.data.unread).toBe(0);
  });
});

describe('logs', () => {
  it('owner reads the clinic audit trail; staff without the permission cannot', async () => {
    await api(owner).post('/inventory-items').send({ name: 'Gloves', unit: 'piece' });
    const audit = await api(owner).get('/logs?kind=audit');
    expect(audit.status).toBe(200);
    expect(audit.body.data.some((r: { entity: string }) => r.entity === 'inventoryItem')).toBe(true);
    expect((await api(reception).get('/logs?kind=audit')).status).toBe(403);
  });
});
