import type { Express } from 'express';
import request from 'supertest';
import { generateSync } from 'otplib';
import { createApp } from '@/app';
import { clearPermissionCache } from '@/core/rbac/permission.service';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { testJobLog } from '@/core/jobs/queue';
import { sentEmails } from '@/core/notifications/email/email.service';
import { hashPassword } from '@/modules/auth/auth.service';
import { createClinic } from '@/modules/platform/onboarding.service';
import { RoleModel } from '@/modules/roles/role.model';
import { syncRoleTemplates } from '@/modules/roles/roles.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel } from '@/modules/users/user.model';
import { decrypt } from '@/shared/crypto';
import { toSearchName } from '@/shared/validation/normalize';

export const PASSWORD = 'Password123!';
let app: Express | null = null;

export function getApp(): Express {
  app ??= createApp();
  return app;
}

export function resetState(): void {
  clearPermissionCache();
  sentEmails.length = 0;
  testJobLog.length = 0;
}

export type Session = { token: string; cookie: string; userId: string; clinicId?: string };

export async function login(email: string, password = PASSWORD): Promise<Session> {
  const res = await request(getApp()).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('eld_rt=')) ?? '';
  return { token: res.body.data.accessToken, cookie: cookie.split(';')[0] ?? '', userId: res.body.data.user.id, clinicId: res.body.data.clinicId ?? undefined };
}

export function api(s?: Session) {
  const agent = request(getApp());
  const wrap = (r: request.Test) => (s ? r.set('Authorization', `Bearer ${s.token}`) : r);
  return {
    get: (url: string) => wrap(agent.get(`/api/v1${url}`)),
    post: (url: string) => wrap(agent.post(`/api/v1${url}`)),
    patch: (url: string) => wrap(agent.patch(`/api/v1${url}`)),
    put: (url: string) => wrap(agent.put(`/api/v1${url}`)),
    delete: (url: string) => wrap(agent.delete(`/api/v1${url}`)),
  };
}

type StaffSpec = { email: string; name: string; staffType: string; role?: string; salary?: number; nationalId?: string };

export async function addStaff(clinicId: string, s: StaffSpec): Promise<{ staffId: string; userId: string }> {
  const user = (await UserModel.findOne({ email: s.email })) ?? (await UserModel.create({ kind: 'staff', email: s.email, displayName: s.name, passwordHash: await hashPassword(PASSWORD) }));
  return runInTenant(clinicId, async () => {
    const role = s.role ? await RoleModel.findOne({ key: s.role }).lean() : null;
    const { encrypt } = await import('@/shared/crypto');
    const staff = await StaffModel.create({
      userId: user._id,
      name: s.name,
      searchName: toSearchName(s.name),
      email: s.email,
      phone: { e164: `+96279${Math.floor(1000000 + Math.random() * 8999999)}` },
      staffType: s.staffType,
      roleIds: role ? [role._id] : [],
      compensation: { basicSalary: s.salary ?? 500_000, currency: 'JOD' },
      ...(s.nationalId ? { nationalIdEnc: encrypt(s.nationalId), nationalIdLast4: s.nationalId.slice(-4) } : {}),
    });
    return { staffId: String(staff._id), userId: String(user._id) };
  });
}

export type TestClinic = { clinicId: string; ownerEmail: string; staff: Record<string, { staffId: string; userId: string; email: string }> };

/** A clinic with owner, dentist, receptionist, accountant and HR (prefix keeps emails unique). */
export async function makeClinic(prefix: string): Promise<TestClinic> {
  await syncRoleTemplates();
  const ownerEmail = `owner@${prefix}.test`;
  const { clinic } = await createClinic({ name: `Clinic ${prefix}`, slug: `clinic-${prefix}`, owner: { name: 'Owner Person', email: ownerEmail, password: PASSWORD }, sendInvite: false });
  const clinicId = String(clinic._id);
  const specs: (StaffSpec & { key: string })[] = [
    { key: 'dentist', email: `dentist@${prefix}.test`, name: 'Dentist One', staffType: 'dentist', role: 'dentist', salary: 1_500_000, nationalId: '9871234567' },
    { key: 'dentist2', email: `dentist2@${prefix}.test`, name: 'Dentist Two', staffType: 'dentist', role: 'dentist', salary: 1_400_000 },
    { key: 'reception', email: `reception@${prefix}.test`, name: 'Reception Person', staffType: 'receptionist', role: 'receptionist', salary: 500_000, nationalId: '9870000001' },
    { key: 'accountant', email: `accountant@${prefix}.test`, name: 'Accountant Person', staffType: 'accountant', role: 'accountant' },
    { key: 'hr', email: `hr@${prefix}.test`, name: 'Hr Person', staffType: 'hr', role: 'hr_manager' },
  ];
  const staff: TestClinic['staff'] = {};
  for (const s of specs) staff[s.key] = { ...(await addStaff(clinicId, s)), email: s.email };
  const owner = await runInTenant(clinicId, () => StaffModel.findOne({ isOwner: true }).lean());
  staff.owner = { staffId: String(owner?._id), userId: String(owner?.userId), email: ownerEmail };
  return { clinicId, ownerEmail, staff };
}

/** Root superadmin with MFA already enabled; returns a logged-in session. */
export async function makeRootSuperadmin(email = 'root@test.local'): Promise<Session> {
  const { encrypt } = await import('@/shared/crypto');
  const { generateSecret } = await import('otplib');
  const secret = generateSecret();
  await UserModel.create({ kind: 'platform', platformRole: 'superadmin', isRootSuperadmin: true, email, displayName: 'Root', passwordHash: await hashPassword(PASSWORD), mfa: { enabled: true, secretEnc: encrypt(secret) } });
  return loginPlatform(email);
}

export async function loginPlatform(email: string): Promise<Session> {
  const step1 = await request(getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (!step1.body.data?.mfaToken) throw new Error(`no mfa challenge: ${JSON.stringify(step1.body)}`);
  const user = await UserModel.findOne({ email }).select('+mfa.secretEnc');
  const code = generateSync({ secret: decrypt(user!.mfa!.secretEnc!) });
  const step2 = await request(getApp()).post('/api/v1/auth/login/mfa').send({ mfaToken: step1.body.data.mfaToken, code });
  if (step2.status !== 200) throw new Error(`mfa failed ${JSON.stringify(step2.body)}`);
  const cookie = (step2.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('eld_rt=')) ?? '';
  return { token: step2.body.data.accessToken, cookie: cookie.split(';')[0] ?? '', userId: step2.body.data.user.id };
}

export function lastEmailCode(): string | undefined {
  const m = sentEmails[sentEmails.length - 1];
  return m ? /(\d{6})/.exec(m.subject)?.[1] : undefined;
}
