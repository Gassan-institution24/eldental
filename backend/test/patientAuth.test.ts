import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from './db';
import { api, resetState } from './helpers';

useTestDb();
beforeEach(() => resetState());

const person = { firstName: 'Lina', lastName: 'Haddad', phone: '0791112233', email: 'lina@example.com' };

describe('patient self-registration (01 §4.10)', () => {
  it('verifies the mobile with an OTP, creates a patient account and signs in', async () => {
    const start = await api().post('/auth/patient/register/start').send(person);
    expect(start.status).toBe(200);
    const code = start.body.data.devCode as string;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await api().post('/auth/patient/register').send({ ...person, code: '000000', password: 'MySmile2026' });
    expect(wrong.status).toBe(422);
    const done = await api().post('/auth/patient/register').send({ ...person, code, password: 'MySmile2026' });
    expect(done.status).toBe(200);
    expect(done.body.data.user.kind).toBe('patient');
    const me = await api({ token: done.body.data.accessToken, cookie: '', userId: '' }).get('/portal/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.phone).toBe('+962791112233');
    // Sign in again with the phone number.
    const loginRes = await api().post('/auth/login').send({ phone: '0791112233', password: 'MySmile2026' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects a phone that is already registered and non-mobile numbers', async () => {
    const start = await api().post('/auth/patient/register/start').send(person);
    await api().post('/auth/patient/register').send({ ...person, code: start.body.data.devCode, password: 'MySmile2026' });
    const again = await api().post('/auth/patient/register/start').send(person);
    expect(again.body.error.details.fields[0]).toMatchObject({ path: 'phone', code: 'duplicate' });
    const landline = await api().post('/auth/patient/register/start').send({ ...person, phone: '064123456' });
    expect(landline.body.error.details.fields[0]).toMatchObject({ path: 'phone', code: 'not_mobile' });
  });

  it('staff tokens cannot use portal endpoints', async () => {
    const { makeClinic, login } = await import('./helpers');
    const c = await makeClinic('pp');
    const s = await login(c.ownerEmail);
    expect((await api(s).get('/portal/me')).status).toBe(403);
  });
});
