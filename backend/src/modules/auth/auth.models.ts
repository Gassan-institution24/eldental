import { Schema, model, type InferSchemaType } from 'mongoose';

/** Opaque rotating refresh tokens, stored hashed (11_SECURITY.md §1). */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic' },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    sessionId: String,
    remember: { type: Boolean, default: true },
    impersonatorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: String,
    replacedByHash: String,
    userAgent: String,
    ip: String,
    lastUsedAt: Date,
  },
  { timestamps: true, collection: 'refreshTokens' },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);

const otpSchema = new Schema(
  {
    target: { type: String, required: true },
    purpose: {
      type: String,
      enum: ['verify_email', 'verify_phone', 'reset_password', 'link_patient', 'login', 'patient_register'],
      required: true,
    },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { timestamps: true, collection: 'otpCodes' },
);
otpSchema.index({ target: 1, purpose: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OtpCode = InferSchemaType<typeof otpSchema>;
export const OtpCodeModel = model('OtpCode', otpSchema);

/** Short-lived MFA challenge between password and TOTP steps. */
const mfaChallengeSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    remember: Boolean,
    setup: Boolean,
    secretEnc: String,
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'mfaChallenges' },
);
mfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const MfaChallengeModel = model('MfaChallenge', mfaChallengeSchema);
