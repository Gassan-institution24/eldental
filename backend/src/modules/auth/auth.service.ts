import bcrypt from 'bcrypt';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { invalidateUserCache } from '@/core/auth/authenticate';
import { ApiError } from '@/core/http/ApiError';
import { emails } from '@/core/notifications/email/email.service';
import { PERMISSIONS } from '@/core/rbac/registry';
import { resolveFields } from '@/core/rbac/resolve';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel, isClinicReadOnly } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel, type UserDoc } from '@/modules/users/user.model';
import { decrypt, encrypt, randomToken, sha256 } from '@/shared/crypto';
import { normalizePhone } from '@/shared/validation/fields';
import { MfaChallengeModel } from './auth.models';
import { issueOtp, verifyOtp } from './otp.service';
import {
  accessTokenFor,
  clinicsOf,
  createRefreshToken,
  familyOf,
  revokeAllForUser,
  revokeFamilyByRaw,
  rotateRefreshToken,
  setFamilyClinic,
  type ClinicChoice,
  type IssuedRefresh,
} from './session.service';

const MAX_FAILED = 5;
// Compared against for unknown accounts so they take as long as known ones (no enumeration).
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await bcrypt.hash(randomToken(12), env.BCRYPT_COST);
  return dummyHash;
}

export type LoginResult = {
  accessToken?: string;
  refresh?: IssuedRefresh;
  user?: ReturnType<typeof publicUser>;
  clinics?: ClinicChoice[];
  clinicId?: string | null;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  mfaToken?: string;
};

export function publicUser(u: UserDoc) {
  return {
    id: String(u._id),
    kind: u.kind,
    displayName: u.displayName,
    email: u.email ?? undefined,
    phone: u.phone?.e164 ?? undefined,
    locale: u.locale,
    isRootSuperadmin: Boolean(u.isRootSuperadmin),
    mfaEnabled: Boolean(u.mfa?.enabled),
    mustChangePassword: Boolean(u.mustChangePassword),
  };
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, env.BCRYPT_COST);
}

async function findByIdentifier(id: { email?: string; phone?: string }): Promise<UserDoc | null> {
  if (id.email) return UserModel.findOne({ email: id.email }).select('+passwordHash +mfa.secretEnc');
  if (id.phone) return UserModel.findOne({ 'phone.e164': id.phone }).select('+passwordHash +mfa.secretEnc');
  return null;
}

function lockMinutes(failed: number): number {
  return Math.min(60, 2 ** Math.max(0, failed - MAX_FAILED));
}

/** Finishes a successful authentication: picks the clinic, issues tokens. */
async function completeLogin(user: UserDoc, remember: boolean): Promise<LoginResult> {
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({ action: 'login', entity: 'user', entityId: user._id, actorUserId: user._id, clinicId: null });

  if (user.kind === 'platform') {
    const refresh = await createRefreshToken(user._id, { remember });
    return { accessToken: await accessTokenFor(user), refresh, user: publicUser(user), clinics: [], clinicId: null };
  }
  if (user.kind === 'patient') {
    const refresh = await createRefreshToken(user._id, { remember });
    return { accessToken: await accessTokenFor(user), refresh, user: publicUser(user), clinics: [], clinicId: null };
  }
  const memberships = await clinicsOf(user._id);
  if (!memberships.length) throw ApiError.forbidden('CLINIC_NOT_AVAILABLE', 'No active clinic membership');
  const clinics = memberships.map(({ staffId: _s, ...c }) => c);
  if (memberships.length === 1) {
    const m = memberships[0]!;
    const refresh = await createRefreshToken(user._id, { remember, clinicId: m.id });
    return { accessToken: await accessTokenFor(user, { clinicId: m.id, staffId: m.staffId, isOwner: m.isOwner }), refresh, user: publicUser(user), clinics, clinicId: m.id };
  }
  const refresh = await createRefreshToken(user._id, { remember });
  return { accessToken: await accessTokenFor(user), refresh, user: publicUser(user), clinics, clinicId: null };
}

async function createMfaChallenge(user: UserDoc, remember: boolean, setup: boolean): Promise<string> {
  const raw = randomToken(24);
  await MfaChallengeModel.create({ tokenHash: sha256(raw), userId: user._id, remember, setup, expiresAt: new Date(Date.now() + 10 * 60_000) });
  return raw;
}

/** POST /auth/login (11 §1): lockout, no enumeration, MFA required for superadmins. */
export async function login(input: { email?: string; phone?: string; password: string; remember: boolean }): Promise<LoginResult> {
  const user = await findByIdentifier(input);
  const hash = user?.passwordHash ?? (await getDummyHash());
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const secs = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked', { retryAfterSeconds: secs, minutes: Math.ceil(secs / 60) });
  }
  const ok = await bcrypt.compare(input.password, hash);
  if (!user || !ok || !user.passwordHash) {
    if (user) {
      user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
      if (user.failedLoginCount >= MAX_FAILED) user.lockedUntil = new Date(Date.now() + lockMinutes(user.failedLoginCount) * 60_000);
      await user.save();
      await recordAudit({ action: 'login_failed', entity: 'user', entityId: user._id, actorUserId: user._id, clinicId: null, summary: `attempt ${user.failedLoginCount}` });
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        const secs = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
        throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked', { retryAfterSeconds: secs, minutes: Math.ceil(secs / 60) });
      }
    }
    throw ApiError.unauthenticated('INVALID_CREDENTIALS', 'Invalid credentials');
  }
  if (user.status === 'disabled') throw ApiError.forbidden('ACCOUNT_DISABLED', 'Account disabled');

  const mfaRequired = user.kind === 'platform' || Boolean(user.mfa?.enabled);
  if (mfaRequired) {
    const setup = !user.mfa?.enabled;
    return { mfaRequired: !setup, mfaSetupRequired: setup, mfaToken: await createMfaChallenge(user, input.remember, setup) };
  }
  return completeLogin(user, input.remember);
}

async function loadChallenge(mfaToken: string) {
  const ch = await MfaChallengeModel.findOne({ tokenHash: sha256(mfaToken) });
  if (!ch || ch.expiresAt.getTime() < Date.now()) throw ApiError.unauthenticated('MFA_INVALID', 'MFA challenge expired');
  if (ch.attempts >= 5) throw new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');
  const user = await UserModel.findById(ch.userId).select('+mfa.secretEnc +mfa.recoveryCodesHash');
  if (!user) throw ApiError.unauthenticated('MFA_INVALID', 'User not found');
  return { ch, user };
}

function verifyTotp(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code }).valid;
  } catch {
    return false;
  }
}

/** POST /auth/login/mfa — TOTP or a one-time recovery code. */
export async function loginMfa(mfaToken: string, code: string): Promise<LoginResult> {
  const { ch, user } = await loadChallenge(mfaToken);
  if (ch.setup || !user.mfa?.enabled || !user.mfa.secretEnc) throw ApiError.unauthenticated('MFA_SETUP_REQUIRED', 'MFA not set up');
  const secret = decrypt(user.mfa.secretEnc);
  let ok = /^\d{6}$/.test(code) && verifyTotp(secret, code);
  if (!ok) {
    const idx = (user.mfa.recoveryCodesHash ?? []).indexOf(sha256(code.toUpperCase()));
    if (idx >= 0) {
      user.mfa.recoveryCodesHash.splice(idx, 1);
      ok = true;
    }
  }
  if (!ok) {
    ch.attempts += 1;
    await ch.save();
    throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  }
  await ch.deleteOne();
  return completeLogin(user, ch.remember ?? true);
}

/** MFA setup: during login (mfaToken) or from settings (authenticated). */
export async function mfaSetup(opts: { mfaToken?: string; auth?: AuthContext }): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
  const user = opts.mfaToken ? (await loadChallenge(opts.mfaToken)).user : await UserModel.findById(opts.auth?.userId);
  if (!user) throw ApiError.unauthenticated();
  const secret = generateSecret();
  const otpauthUrl = generateURI({ secret, label: user.email ?? user.displayName, issuer: env.APP_NAME });
  if (opts.mfaToken) {
    await MfaChallengeModel.updateOne({ tokenHash: sha256(opts.mfaToken) }, { $set: { secretEnc: encrypt(secret) } });
  } else {
    await UserModel.updateOne({ _id: user._id }, { $set: { 'mfa.secretEnc': encrypt(secret), 'mfa.enabled': false } });
  }
  return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }) };
}

function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 8 }, () => randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase().padEnd(8, 'X'));
  return { codes, hashes: codes.map((c) => sha256(c)) };
}

export async function mfaEnable(opts: { code: string; mfaToken?: string; auth?: AuthContext }): Promise<LoginResult & { recoveryCodes: string[] }> {
  if (opts.mfaToken) {
    const { ch, user } = await loadChallenge(opts.mfaToken);
    if (!ch.secretEnc) throw ApiError.badRequest('MFA_INVALID', 'Call setup first');
    const secret = decrypt(ch.secretEnc);
    if (!verifyTotp(secret, opts.code)) {
      ch.attempts += 1;
      await ch.save();
      throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
    }
    const { codes, hashes } = newRecoveryCodes();
    user.mfa = { enabled: true, secretEnc: ch.secretEnc, recoveryCodesHash: hashes };
    await user.save();
    await ch.deleteOne();
    await recordAudit({ action: 'update', entity: 'user', entityId: user._id, summary: 'mfa_enabled', actorUserId: user._id, clinicId: null });
    const res = await completeLogin(user, ch.remember ?? true);
    return { ...res, recoveryCodes: codes };
  }
  const user = await UserModel.findById(opts.auth?.userId).select('+mfa.secretEnc');
  if (!user?.mfa?.secretEnc) throw ApiError.badRequest('MFA_INVALID', 'Call setup first');
  if (!verifyTotp(decrypt(user.mfa.secretEnc), opts.code)) throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  const { codes, hashes } = newRecoveryCodes();
  user.mfa.enabled = true;
  user.mfa.recoveryCodesHash = hashes;
  await user.save();
  await recordAudit({ action: 'update', entity: 'user', entityId: user._id, summary: 'mfa_enabled' });
  return { recoveryCodes: codes };
}

export async function mfaDisable(auth: AuthContext, code: string): Promise<void> {
  const user = await UserModel.findById(auth.userId).select('+mfa.secretEnc');
  if (!user) throw ApiError.unauthenticated();
  if (user.kind === 'platform') throw ApiError.forbidden('MFA_REQUIRED', 'Superadmins must keep MFA');
  if (!user.mfa?.secretEnc || !verifyTotp(decrypt(user.mfa.secretEnc), code)) throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  user.mfa = { enabled: false, secretEnc: undefined, recoveryCodesHash: [] };
  await user.save();
  await recordAudit({ action: 'update', entity: 'user', entityId: user._id, summary: 'mfa_disabled' });
}

/** POST /auth/refresh — rotates and returns a new access token for the same clinic. */
export async function refresh(raw: string | undefined): Promise<{ accessToken: string; refresh: IssuedRefresh }> {
  if (!raw) throw ApiError.unauthenticated('SESSION_REVOKED', 'No refresh token');
  const { refresh: next, token } = await rotateRefreshToken(raw);
  const user = await UserModel.findById(token.userId);
  if (!user || user.status === 'disabled') throw ApiError.unauthenticated('ACCOUNT_DISABLED', 'Account disabled');
  if (token.clinicId && user.kind === 'staff') {
    const staff = await StaffModel.findOne({ userId: user._id, status: 'active' }).setOptions({ clinicId: token.clinicId }).select('isOwner').lean();
    if (!staff) throw ApiError.unauthenticated('SESSION_REVOKED', 'Clinic access revoked');
    const imp = token.impersonatorUserId ? String(token.impersonatorUserId) : undefined;
    return {
      accessToken: await accessTokenFor(user, { clinicId: String(token.clinicId), staffId: String(staff._id), isOwner: Boolean(staff.isOwner), ...(imp ? { impersonatorUserId: imp, readOnly: true } : {}) }),
      refresh: next,
    };
  }
  if (user.kind === 'patient') {
    return { accessToken: await accessTokenFor(user, token.patientId ? { patientId: String(token.patientId), ...(token.clinicId ? { clinicId: String(token.clinicId) } : {}) } : {}), refresh: next };
  }
  return { accessToken: await accessTokenFor(user), refresh: next };
}

export async function selectClinic(auth: AuthContext, clinicId: string, rawRefresh: string | undefined): Promise<{ accessToken: string }> {
  const user = await UserModel.findById(auth.userId);
  if (!user || user.kind !== 'staff') throw ApiError.forbidden();
  const m = (await clinicsOf(user._id)).find((c) => c.id === clinicId);
  if (!m) throw ApiError.forbidden('CLINIC_NOT_AVAILABLE', 'No access to this clinic');
  await setFamilyClinic(rawRefresh, clinicId);
  await recordAudit({ action: 'access', entity: 'clinic', entityId: clinicId, summary: 'select_clinic', clinicId });
  return { accessToken: await accessTokenFor(user, { clinicId, staffId: m.staffId, isOwner: m.isOwner }) };
}

export async function logout(auth: AuthContext | undefined, raw: string | undefined): Promise<void> {
  await revokeFamilyByRaw(raw);
  if (auth) await recordAudit({ action: 'logout', entity: 'user', entityId: auth.userId });
}

export async function logoutAll(auth: AuthContext): Promise<void> {
  await revokeAllForUser(auth.userId);
  await recordAudit({ action: 'logout', entity: 'user', entityId: auth.userId, summary: 'logout_all' });
}

function targetOf(raw: string): { email?: string; phone?: string; key: string } | null {
  if (raw.includes('@')) {
    const email = raw.trim().toLowerCase();
    return { email, key: email };
  }
  const phone = normalizePhone(raw);
  return phone ? { phone, key: phone } : null;
}

/** Always 204 — never reveals whether the account exists (11 §1). */
export async function forgotPassword(rawTarget: string): Promise<void> {
  const target = targetOf(rawTarget);
  if (!target) return;
  const user = await findByIdentifier(target);
  if (!user || user.status === 'disabled') return;
  const issued = await issueOtp(target.key, 'reset_password');
  if (!('code' in issued)) return;
  // A phone number also gets the code by email when the account has one (WhatsApp may be off).
  const mailTo = target.email ?? user.email;
  if (mailTo) await emails.otp(mailTo, user.locale, issued.code);
  if (target.phone) {
    const { sendOtpWhatsApp } = await import('@/modules/notifications/whatsapp.hooks');
    await sendOtpWhatsApp(target.phone, user.locale, issued.code);
  }
}

export async function resetPassword(input: { target: string; code: string; newPassword: string }): Promise<void> {
  const target = targetOf(input.target);
  if (!target) throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  await verifyOtp(target.key, 'reset_password', input.code);
  const user = await findByIdentifier(target);
  if (!user) throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  await setPassword(user, input.newPassword);
  await revokeAllForUser(user._id);
  await recordAudit({ action: 'update', entity: 'user', entityId: user._id, summary: 'password_reset', actorUserId: user._id, clinicId: null });
  if (user.email) await emails.passwordChanged(user.email, user.locale);
}

async function setPassword(user: UserDoc, pw: string): Promise<void> {
  user.passwordHash = await hashPassword(pw);
  // Second resolution: tokens issued in the same second as the change stay valid.
  user.passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  user.mustChangePassword = false;
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  await user.save();
  invalidateUserCache(String(user._id));
}

/** Changes the password, revokes other sessions, returns a fresh access token for this one. */
export async function changePassword(auth: AuthContext, input: { currentPassword: string; newPassword: string }, rawRefresh: string | undefined): Promise<{ accessToken: string }> {
  const user = await UserModel.findById(auth.userId).select('+passwordHash');
  if (!user?.passwordHash) throw ApiError.unauthenticated();
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw ApiError.validation([{ path: 'currentPassword', code: 'invalid' }]);
  }
  if (await bcrypt.compare(input.newPassword, user.passwordHash)) throw ApiError.validation([{ path: 'newPassword', code: 'weak_password' }]);
  await setPassword(user, input.newPassword);
  await revokeAllForUser(user._id, await familyOf(rawRefresh));
  await recordAudit({ action: 'update', entity: 'user', entityId: user._id, summary: 'password_changed' });
  if (user.email) await emails.passwordChanged(user.email, user.locale);
  return { accessToken: await accessTokenFor(user, { clinicId: auth.clinicId, staffId: auth.staffId, isOwner: auth.isOwner }) };
}

export async function invitationInfo(token: string): Promise<{ email?: string; displayName: string; clinicName?: string }> {
  const user = await UserModel.findOne({ 'invitation.tokenHash': sha256(token) });
  if (!user?.invitation?.expiresAt || user.invitation.expiresAt.getTime() < Date.now()) throw ApiError.notFound('INVITATION_INVALID', 'Invitation invalid');
  const clinic = user.invitation.clinicId ? await runWithoutTenant(() => ClinicModel.findById(user.invitation?.clinicId).select('name').lean()) : null;
  return { email: user.email ?? undefined, displayName: user.displayName, ...(clinic ? { clinicName: clinic.name } : {}) };
}

export async function acceptInvitation(input: { token: string; password: string }): Promise<LoginResult> {
  const user = await UserModel.findOne({ 'invitation.tokenHash': sha256(input.token) }).select('+passwordHash');
  if (!user?.invitation?.expiresAt || user.invitation.expiresAt.getTime() < Date.now()) throw ApiError.notFound('INVITATION_INVALID', 'Invitation invalid');
  await setPassword(user, input.password);
  user.invitation = undefined;
  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  await user.save();
  await recordAudit({ action: 'update', entity: 'user', entityId: user._id, summary: 'invitation_accepted', actorUserId: user._id, clinicId: null });
  if (user.kind === 'platform') {
    return { mfaSetupRequired: true, mfaToken: await createMfaChallenge(user, true, true) };
  }
  return completeLogin(user, true);
}

/** Creates an invitation token (7 days) and emails it. */
export async function sendInvitation(user: UserDoc, clinic: { id: string; name: string } | null): Promise<string> {
  const raw = randomToken(32);
  user.invitation = { tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86_400_000), clinicId: clinic ? (clinic.id as never) : undefined };
  await user.save();
  const url = `${env.FRONTEND_URL}/invite/${raw}`;
  if (user.email) await emails.invitation(user.email, user.locale, { name: user.displayName, clinic: clinic?.name ?? env.APP_NAME, url });
  return raw;
}

export async function sendVerification(auth: AuthContext, channel: 'email' | 'phone'): Promise<void> {
  const user = await UserModel.findById(auth.userId);
  if (!user) throw ApiError.unauthenticated();
  const target = channel === 'email' ? user.email : user.phone?.e164;
  if (!target) throw ApiError.validation([{ path: 'channel', code: 'invalid_option' }]);
  const issued = await issueOtp(target, channel === 'email' ? 'verify_email' : 'verify_phone');
  if (!('code' in issued)) throw new ApiError(429, 'OTP_COOLDOWN', 'Wait before requesting another code', { seconds: issued.cooldown });
  if (channel === 'email') await emails.otp(target, user.locale, issued.code);
  else {
    const { sendOtpWhatsApp } = await import('@/modules/notifications/whatsapp.hooks');
    await sendOtpWhatsApp(target, user.locale, issued.code);
  }
}

export async function confirmVerification(auth: AuthContext, channel: 'email' | 'phone', code: string): Promise<void> {
  const user = await UserModel.findById(auth.userId);
  if (!user) throw ApiError.unauthenticated();
  const target = channel === 'email' ? user.email : user.phone?.e164;
  if (!target) throw ApiError.validation([{ path: 'channel', code: 'invalid_option' }]);
  await verifyOtp(target, channel === 'email' ? 'verify_email' : 'verify_phone', code);
  if (channel === 'email') user.emailVerifiedAt = new Date();
  else user.phoneVerifiedAt = new Date();
  await user.save();
}

/** GET /auth/me — `{ user, clinic, staff, grants, isOwner }` (05 §7, 04 §4.5). */
export async function me(auth: AuthContext) {
  const user = await UserModel.findById(auth.userId);
  if (!user) throw ApiError.unauthenticated();
  user.lastActiveAt = new Date();
  await user.save();
  const clinics = user.kind === 'staff' ? (await clinicsOf(user._id)).map(({ staffId: _s, ...c }) => c) : [];
  let clinic = null;
  let staff = null;
  if (auth.clinicId && auth.kind === 'staff') {
    const c = await runWithoutTenant(() => ClinicModel.findById(auth.clinicId).lean());
    const s = await StaffModel.findOne({ _id: auth.staffId }).setOptions({ clinicId: auth.clinicId }).select('name staffType isOwner color').lean();
    if (c) {
      clinic = {
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        timezone: c.timezone,
        currency: c.currency,
        locale: c.locale,
        status: c.status,
        subscriptionStatus: c.subscription?.status ?? 'active',
        readOnly: isClinicReadOnly(c),
        onboardingCompleted: Boolean(c.onboarding?.completedAt),
      };
    }
    if (s) staff = { id: String(s._id), name: s.name, staffType: s.staffType, isOwner: Boolean(s.isOwner), color: s.color };
  }
  let grants = auth.grants;
  if (auth.kind === 'staff' && auth.isOwner) {
    grants = Object.fromEntries(
      Object.keys(PERMISSIONS).map((k) => {
        const fields = Object.fromEntries(Object.keys(resolveFields({ permission: k })).map((f) => [f, 'write' as const]));
        return [k, { scope: 'all' as const, fields }];
      }),
    );
  }
  let impersonation = null;
  if (auth.impersonatorUserId) {
    const imp = await UserModel.findById(auth.impersonatorUserId).select('displayName').lean();
    impersonation = { byUserId: auth.impersonatorUserId, byName: imp?.displayName ?? '' };
  }
  return {
    user: publicUser(user),
    clinic,
    staff,
    grants,
    isOwner: auth.isOwner,
    clinics,
    impersonation,
    readOnly: auth.readOnly,
    ...(auth.patientId ? { patientIds: [auth.patientId] } : {}),
  };
}
