import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { RefreshTokenModel } from '@/modules/auth/auth.models';
import { UserModel } from '@/modules/users/user.model';
import { useTestDb } from './db';
import { api, getApp, lastEmailCode, login, makeClinic, makeRootSuperadmin, PASSWORD, resetState, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;

beforeEach(async () => {
  resetState();
  c = await makeClinic('a');
});

describe('login', () => {
  it('returns a clinic token and sets an httpOnly refresh cookie', async () => {
    const res = await request(getApp()).post('/api/v1/auth/login').send({ email: c.ownerEmail, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.clinicId).toBe(c.clinicId);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('does not reveal whether an account exists', async () => {
    const unknown = await request(getApp()).post('/api/v1/auth/login').send({ email: 'nobody@x.test', password: 'whatever123' });
    const wrong = await request(getApp()).post('/api/v1/auth/login').send({ email: c.ownerEmail, password: 'wrongpass123' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after 5 failures with a countdown', async () => {
    for (let i = 0; i < 4; i += 1) await request(getApp()).post('/api/v1/auth/login').send({ email: c.ownerEmail, password: 'wrongpass123' });
    const fifth = await request(getApp()).post('/api/v1/auth/login').send({ email: c.ownerEmail, password: 'wrongpass123' });
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    const right = await request(getApp()).post('/api/v1/auth/login').send({ email: c.ownerEmail, password: PASSWORD });
    expect(right.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('validates the body (422 with codes)', async () => {
    const res = await request(getApp()).post('/api/v1/auth/login').send({ email: 'bad', password: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'email', code: 'invalid_email' })]));
  });
});

describe('/auth/me', () => {
  it('requires a verified token', async () => {
    expect((await api().get('/auth/me')).status).toBe(401);
    const forged = await api().get('/auth/me').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad');
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('TOKEN_INVALID');
  });

  it('returns user, clinic, staff and effective grants with field maps', async () => {
    const s = await login(c.staff.reception!.email);
    const res = await api(s).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.clinic.id).toBe(c.clinicId);
    expect(res.body.data.staff.staffType).toBe('receptionist');
    expect(res.body.data.grants['staff.member.read'].fields.basicSalary).toBe('hidden');
    expect(res.body.data.grants['staff.member.read'].fields.phone).toBe('read');
    expect(res.body.data.grants['accounting.journal.read']).toBeUndefined();
  });
});

describe('refresh rotation', () => {
  it('rotates the token and detects reuse (revokes the family)', async () => {
    const s = await login(c.ownerEmail);
    const r1 = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(r1.status).toBe(200);
    const newCookie = String((r1.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
    expect(newCookie).not.toBe(s.cookie);
    // A parallel request (another tab, a reload) presenting it moments later still gets in.
    const parallel = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(parallel.status).toBe(200);
    // After the grace window, reusing the old (rotated) token → whole family revoked.
    await RefreshTokenModel.updateMany({ revokedReason: 'rotated' }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
    const reuse = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');
    const afterReuse = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', newCookie);
    expect(afterReuse.status).toBe(401);
    expect(await RefreshTokenModel.countDocuments({ revokedReason: 'reuse_detected' })).toBeGreaterThan(0);
  });

  it('logout revokes the session', async () => {
    const s = await login(c.ownerEmail);
    await request(getApp()).post('/api/v1/auth/logout').set('Cookie', s.cookie);
    expect((await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('the grace window never reopens a logged-out session', async () => {
    const s = await login(c.ownerEmail);
    const r1 = await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    const fresh = String((r1.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;
    await request(getApp()).post('/api/v1/auth/logout').set('Cookie', fresh);
    // The old token was rotated seconds ago, but the session is gone.
    expect((await request(getApp()).post('/api/v1/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
  });
});

describe('multi-clinic', () => {
  it('asks to select a clinic and issues a clinic-scoped token', async () => {
    const b = await makeClinic('b');
    // The dentist of A also works at B.
    const { addStaff } = await import('./helpers');
    await addStaff(b.clinicId, { email: c.staff.dentist!.email, name: 'Dentist One', staffType: 'dentist', role: 'dentist' });
    const s = await login(c.staff.dentist!.email);
    expect(s.clinicId).toBeUndefined();
    const forbidden = await api(s).get('/staff');
    expect(forbidden.body.error.code).toBe('CLINIC_SELECTION_REQUIRED');
    const sel = await api(s).post('/auth/select-clinic').send({ clinicId: b.clinicId }).set('Cookie', s.cookie);
    expect(sel.status).toBe(200);
    const me = await api({ ...s, token: sel.body.data.accessToken }).get('/auth/me');
    expect(me.body.data.clinic.id).toBe(b.clinicId);
    expect(me.body.data.clinics).toHaveLength(2);
  });
});

describe('password reset & change', () => {
  it('forgot always returns 204 and reset works with the emailed OTP', async () => {
    expect((await api().post('/auth/password/forgot').send({ target: 'nobody@x.test' })).status).toBe(204);
    expect((await api().post('/auth/password/forgot').send({ target: c.ownerEmail })).status).toBe(204);
    const code = lastEmailCode();
    expect(code).toMatch(/^\d{6}$/);
    const bad = await api().post('/auth/password/reset').send({ target: c.ownerEmail, code: '000000', newPassword: 'NewPassword456' });
    expect(bad.status).toBe(422);
    const ok = await api().post('/auth/password/reset').send({ target: c.ownerEmail, code, newPassword: 'NewPassword456' });
    expect(ok.status).toBe(204);
    await expect(login(c.ownerEmail, 'NewPassword456')).resolves.toBeTruthy();
  });

  it('change password rejects old tokens issued before the change', async () => {
    const s = await login(c.ownerEmail);
    await new Promise((r) => setTimeout(r, 1100));
    const res = await api(s).post('/auth/password/change').send({ currentPassword: PASSWORD, newPassword: 'AnotherPass789' });
    expect(res.status).toBe(200);
    const old = await api(s).get('/auth/me');
    expect(old.status).toBe(401);
    const fresh = await api({ ...s, token: res.body.data.accessToken }).get('/auth/me');
    expect(fresh.status).toBe(200);
  });

  it('rejects weak passwords with a code', async () => {
    const s = await login(c.ownerEmail);
    const res = await api(s).post('/auth/password/change').send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.body.error.details.fields[0]).toMatchObject({ path: 'newPassword', code: 'weak_password' });
  });
});

describe('invitation', () => {
  it('invites staff, emails a link, and accepting it logs in', async () => {
    const owner = await login(c.ownerEmail);
    const res = await api(owner).post('/staff').send({ name: 'New Assistant', email: 'new@a.test', staffType: 'assistant' });
    expect(res.status).toBe(201);
    const { sentEmails } = await import('@/core/notifications/email/email.service');
    const mail = sentEmails.find((m) => m.to === 'new@a.test');
    const token = /invite\/([A-Za-z0-9_-]+)/.exec(mail?.html ?? '')?.[1];
    expect(token).toBeTruthy();
    const info = await api().get(`/auth/invitations/${token}`);
    expect(info.body.data.clinicName).toBe('Clinic a');
    const accept = await api().post('/auth/invitations/accept').send({ token, password: 'WelcomePass123' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.clinicId).toBe(c.clinicId);
  });
});

describe('superadmin MFA', () => {
  it('requires MFA setup on first login for a superadmin', async () => {
    const { hashPassword } = await import('@/modules/auth/auth.service');
    await UserModel.create({ kind: 'platform', platformRole: 'superadmin', isRootSuperadmin: true, email: 'new-root@test.local', displayName: 'R', passwordHash: await hashPassword(PASSWORD) });
    const res = await request(getApp()).post('/api/v1/auth/login').send({ email: 'new-root@test.local', password: PASSWORD });
    expect(res.body.data.mfaSetupRequired).toBe(true);
    expect(res.body.data.accessToken).toBeUndefined();
    const setup = await api().post('/auth/mfa/setup').send({ mfaToken: res.body.data.mfaToken });
    expect(setup.body.data.qrDataUrl).toMatch(/^data:image\/png/);
    const { generateSync } = await import('otplib');
    const enable = await api().post('/auth/mfa/enable').send({ mfaToken: res.body.data.mfaToken, code: generateSync({ secret: setup.body.data.secret }) });
    expect(enable.status).toBe(200);
    expect(enable.body.data.accessToken).toBeTruthy();
    expect(enable.body.data.recoveryCodes).toHaveLength(8);
  });

  it('root logs in with TOTP', async () => {
    const s = await makeRootSuperadmin();
    const me = await api(s).get('/auth/me');
    expect(me.body.data.user.isRootSuperadmin).toBe(true);
    expect(me.body.data.grants['platform.superadmin.manage']).toBeTruthy();
  });
});
