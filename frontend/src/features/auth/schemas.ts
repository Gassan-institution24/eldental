import { z } from 'zod';
import { otpCode, password } from '@/shared/generated/validation/fields';
import { toWesternDigits } from '@/shared/generated/validation/normalize';

/** Email or phone in one input. Phones are kept as typed; the server normalises them. */
export const identifier = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? toWesternDigits(v).trim() : v),
    z
      .string({ required_error: 'required' })
      .min(1, { message: 'required' })
      .max(254, { message: 'too_long' })
      .refine((v) => (v.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) : /^\+?[\d\s\-()]{7,20}$/.test(v)), { message: 'invalid_format' }),
  );

export const loginSchema = z.object({
  identifier: identifier(),
  password: z.string({ required_error: 'required' }).min(1, { message: 'required' }),
  remember: z.boolean().default(true),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const mfaSchema = z.object({ code: otpCode() });

export const forgotSchema = z.object({ target: identifier() });

export const resetSchema = z
  .object({ code: otpCode(), newPassword: password(), confirmPassword: z.string().min(1, { message: 'required' }) })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'password_mismatch' });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, { message: 'required' }), newPassword: password(), confirmPassword: z.string().min(1, { message: 'required' }) })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'password_mismatch' });

export const acceptInvitationSchema = z
  .object({ password: password(), confirmPassword: z.string().min(1, { message: 'required' }) })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'password_mismatch' });
