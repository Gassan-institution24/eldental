import { env } from '@/config/env';
import { ApiError } from '@/core/http/ApiError';
import { randomDigits, safeEqual, sha256 } from '@/shared/crypto';
import { OtpCodeModel, type OtpCode } from './auth.models';

type Purpose = OtpCode['purpose'];
const MAX_ATTEMPTS = 5;
export const OTP_COOLDOWN_SECONDS = 60;

/** 6 digits, hashed, TTL from env (10 min), max 5 attempts, 60 s resend cooldown (11 §1). */
export async function issueOtp(target: string, purpose: Purpose): Promise<{ code: string } | { cooldown: number }> {
  const existing = await OtpCodeModel.findOne({ target, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (existing && Date.now() - existing.lastSentAt.getTime() < OTP_COOLDOWN_SECONDS * 1000) {
    return { cooldown: Math.ceil(OTP_COOLDOWN_SECONDS - (Date.now() - existing.lastSentAt.getTime()) / 1000) };
  }
  await OtpCodeModel.deleteMany({ target, purpose });
  const code = randomDigits(6);
  await OtpCodeModel.create({
    target,
    purpose,
    codeHash: sha256(`${purpose}:${target}:${code}`),
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
  });
  return { code };
}

/** Verifies and consumes a code. Wrong codes count towards the attempt limit. */
export async function verifyOtp(target: string, purpose: Purpose, code: string, consume = true): Promise<void> {
  const otp = await OtpCodeModel.findOne({ target, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (!otp) throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  if (otp.expiresAt.getTime() < Date.now()) throw ApiError.validation([{ path: 'code', code: 'code_expired' }]);
  if (otp.attempts >= MAX_ATTEMPTS) throw new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');
  if (!safeEqual(otp.codeHash, sha256(`${purpose}:${target}:${code}`))) {
    otp.attempts += 1;
    await otp.save();
    throw ApiError.validation([{ path: 'code', code: 'invalid_code' }]);
  }
  if (consume) {
    otp.consumedAt = new Date();
    await otp.save();
  }
}
