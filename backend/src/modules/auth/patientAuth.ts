import { Router } from 'express';
import { z } from 'zod';
import { env, isProd } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { ok } from '@/core/http/response';
import { publicRoute } from '@/core/http/routeMeta';
import { publicBookingRateLimit } from '@/core/http/security';
import { emails } from '@/core/notifications/email/email.service';
import { registerPath } from '@/core/openapi/registry';
import { requirePatient } from '@/core/rbac/authorize';
import { body, validate } from '@/core/validation/validate';
import { sendOtpWhatsApp } from '@/modules/notifications/whatsapp.hooks';
import { UserModel } from '@/modules/users/user.model';
import { email, enumOf, optional, otpCode, password, personName, phone } from '@/shared/validation/fields';
import { hashPassword, login, publicUser } from './auth.service';
import { issueOtp, verifyOtp } from './otp.service';

/** Step 1: name + mobile (+ optional email) → OTP to the mobile (WhatsApp) and email (01 §4.10). */
export const patientRegisterStartBody = z
  .object({
    firstName: personName(),
    lastName: personName(),
    phone: phone({ mobile: true }),
    email: optional(email()),
    locale: optional(enumOf(['ar', 'en'])),
  })
  .strict();

/** Step 2: the code + a password creates the account and signs in. */
export const patientRegisterCompleteBody = patientRegisterStartBody
  .extend({ code: otpCode(), password: password() })
  .strict();

export const patientAuthRouter = Router();

patientAuthRouter.post(
  '/auth/patient/register/start',
  publicRoute(),
  publicBookingRateLimit,
  validate({ body: patientRegisterStartBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, patientRegisterStartBody);
    const taken = await UserModel.exists({ 'phone.e164': b.phone });
    if (taken) throw ApiError.validation([{ path: 'phone', code: 'duplicate' }]);
    if (b.email && (await UserModel.exists({ email: b.email }))) throw ApiError.validation([{ path: 'email', code: 'duplicate' }]);
    const issued = await issueOtp(b.phone, 'patient_register');
    if (!('code' in issued)) throw new ApiError(429, 'OTP_COOLDOWN', 'Wait before requesting another code', { seconds: issued.cooldown });
    const lang: 'ar' | 'en' = b.locale === 'en' ? 'en' : 'ar';
    await sendOtpWhatsApp(b.phone, lang, issued.code);
    if (b.email) await emails.otp(b.email, lang, issued.code);
    // Development has no WhatsApp provider: hand the code back so the flow can be tried.
    ok(res, { sent: true, expiresInMinutes: env.OTP_TTL_MINUTES, ...(isProd ? {} : { devCode: issued.code }) });
  }),
);

patientAuthRouter.post(
  '/auth/patient/register',
  publicRoute(),
  publicBookingRateLimit,
  validate({ body: patientRegisterCompleteBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, patientRegisterCompleteBody);
    await verifyOtp(b.phone, 'patient_register', b.code);
    if (await UserModel.exists({ 'phone.e164': b.phone })) throw ApiError.validation([{ path: 'phone', code: 'duplicate' }]);
    const user = await UserModel.create({
      kind: 'patient',
      displayName: `${b.firstName} ${b.lastName}`,
      phone: { e164: b.phone, countryCode: b.phone.slice(1, 4), number: b.phone.slice(4) },
      ...(b.email ? { email: b.email } : {}),
      locale: b.locale === 'en' ? 'en' : 'ar',
      passwordHash: await hashPassword(b.password),
      phoneVerifiedAt: new Date(),
    });
    await recordAudit({ action: 'create', entity: 'user', entityId: user._id, actorUserId: user._id, clinicId: null, summary: 'patient_registered' });
    const result = await login({ phone: b.phone, password: b.password, remember: true });
    const { setRefreshCookieFor } = await import('./auth.routes');
    setRefreshCookieFor(res, result.refresh);
    const { refresh: _r, ...rest } = result;
    ok(res, rest);
  }),
);

patientAuthRouter.get(
  '/portal/me',
  requirePatient(),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.auth!.userId);
    if (!user) throw ApiError.unauthenticated();
    // Linked clinic files arrive with the patients module (Phase 3/9).
    ok(res, { user: publicUser(user), clinics: [], patients: [] });
  }),
);

registerPath({ method: 'post', path: '/auth/patient/register/start', tags: ['patient portal'], summary: 'Send a verification code to a new patient', body: patientRegisterStartBody, isPublic: true });
registerPath({ method: 'post', path: '/auth/patient/register', tags: ['patient portal'], summary: 'Create the patient account and sign in', body: patientRegisterCompleteBody, isPublic: true });
registerPath({ method: 'get', path: '/portal/me', tags: ['patient portal'], summary: 'Signed-in patient' });
