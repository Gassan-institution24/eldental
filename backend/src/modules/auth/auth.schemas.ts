import { z } from 'zod';
import { email, objectId, otpCode, password, phone } from '@/shared/validation/fields';
import { toWesternDigits } from '@/shared/validation/normalize';

const identifierTarget = z.preprocess(
  (v) => (typeof v === 'string' ? toWesternDigits(v).trim() : v),
  z.string({ required_error: 'required' }).min(3, { message: 'required' }).max(254, { message: 'too_long' }),
);

export const loginBody = z
  .object({
    email: email().optional(),
    phone: phone().optional(),
    password: z.string({ required_error: 'required' }).min(1, { message: 'required' }).max(128, { message: 'too_long' }),
    remember: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'required' });

export const loginMfaBody = z.object({ mfaToken: z.string().min(10).max(200), code: z.string().min(6).max(12) }).strict();
export const selectClinicBody = z.object({ clinicId: objectId() }).strict();
export const forgotBody = z.object({ target: identifierTarget }).strict();
export const resetBody = z.object({ target: identifierTarget, code: otpCode(), newPassword: password() }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1, { message: 'required' }), newPassword: password() }).strict();
export const acceptInvitationBody = z.object({ token: z.string().min(20).max(200), password: password() }).strict();
export const invitationParams = z.object({ token: z.string().min(20).max(200) });
export const mfaSetupBody = z.object({ mfaToken: z.string().min(10).max(200).optional() }).strict();
export const mfaEnableBody = z.object({ code: otpCode(), mfaToken: z.string().min(10).max(200).optional() }).strict();
export const mfaDisableBody = z.object({ code: z.string().min(6).max(12) }).strict();
export const verifySendBody = z.object({ channel: z.enum(['email', 'phone']) }).strict();
export const verifyConfirmBody = z.object({ channel: z.enum(['email', 'phone']), code: otpCode() }).strict();
