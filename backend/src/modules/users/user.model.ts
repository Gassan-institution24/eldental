import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBase } from '@/core/db/plugins';

export const phoneSchema = new Schema(
  { countryCode: String, number: String, e164: { type: String } },
  { _id: false },
);

const grantSchema = new Schema(
  {
    permission: { type: String, required: true },
    scope: { type: String, enum: ['own', 'all'], default: 'all' },
    fields: { type: Schema.Types.Mixed },
    clinicIds: { type: [String], default: undefined },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    phone: { type: phoneSchema, default: undefined },
    passwordHash: { type: String, select: false },
    kind: { type: String, enum: ['platform', 'staff', 'patient'], required: true },
    platformRole: { type: String, enum: ['superadmin', null], default: null },
    isRootSuperadmin: { type: Boolean, default: false },
    platformPermissions: { type: [grantSchema], default: [] },
    displayName: { type: String, required: true, trim: true },
    avatarFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
    emailVerifiedAt: Date,
    phoneVerifiedAt: Date,
    passwordChangedAt: Date,
    mustChangePassword: { type: Boolean, default: false },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, select: false },
      recoveryCodesHash: { type: [String], default: [], select: false },
    },
    status: { type: String, enum: ['active', 'disabled', 'locked'], default: 'active' },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
    lastActiveAt: Date,
    invitation: {
      tokenHash: { type: String, select: false },
      expiresAt: Date,
      clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic' },
    },
  },
  { timestamps: true, collection: 'users' },
);
applyBase(userSchema, { tenant: false });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ 'phone.e164': 1 }, { unique: true, partialFilterExpression: { 'phone.e164': { $type: 'string' } } });
userSchema.index({ kind: 1, platformRole: 1 });
userSchema.index({ 'invitation.tokenHash': 1 }, { sparse: true });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
