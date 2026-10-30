import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';
import { phoneSchema } from '@/modules/users/user.model';

const grantSchema = new Schema(
  {
    permission: { type: String, required: true },
    scope: { type: String, enum: ['own', 'all'] },
    fields: { type: Schema.Types.Mixed },
    revoked: { type: Boolean },
  },
  { _id: false },
);

const amountLine = new Schema(
  { componentId: { type: Schema.Types.ObjectId, ref: 'SalaryComponent' }, amount: { type: Number, default: 0 } },
  { _id: false },
);

/** One document per (user, clinic) — replaces Hakeemna employees + engagement (03 §3). */
const staffSchema = new Schema(
  {
    clinicId: tenantField,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fileNumber: String,
    name: { type: String, required: true, trim: true },
    searchName: String,
    phone: { type: phoneSchema, default: undefined },
    email: { type: String, lowercase: true, trim: true },
    address: String,
    gender: { type: String, enum: ['male', 'female'] },
    dateOfBirth: String,
    nationalIdEnc: { type: String, select: false },
    nationalIdLast4: String,
    nationality: String,
    jobTitle: String,
    staffType: {
      type: String,
      enum: ['dentist', 'hygienist', 'assistant', 'receptionist', 'accountant', 'hr', 'manager', 'other'],
      required: true,
    },
    isOwner: { type: Boolean, default: false },
    roleIds: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    permissionOverrides: { type: [grantSchema], default: [] },
    specialty: String,
    licenseNumber: String,
    licenseExpiry: String,
    signatureFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    stampFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    avatarFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    color: { type: String, default: '#0E7C86' },
    bookableOnline: { type: Boolean, default: false },
    defaultChairId: { type: Schema.Types.ObjectId, ref: 'Chair' },
    employment: {
      type: { type: String, enum: ['full_time', 'part_time', 'contractor'], default: 'full_time' },
      hireDate: String,
      endDate: String,
      probationEndDate: String,
    },
    compensation: {
      basicSalary: { type: Number, default: 0 },
      currency: { type: String, default: 'JOD' },
      payFrequency: { type: String, enum: ['monthly'], default: 'monthly' },
      allowances: { type: [amountLine], default: [] },
      deductions: { type: [amountLine], default: [] },
      socialSecurity: {
        enrolled: { type: Boolean, default: true },
        employeeRateBp: Number,
        employerRateBp: Number,
      },
      commission: {
        basis: { type: String, enum: ['production', 'collection'] },
        percent: Number,
        appliesTo: { type: [String], default: undefined },
        netOfLabCost: Boolean,
      },
    },
    bank: { bankName: String, ibanEnc: { type: String, select: false }, ibanLast4: String },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    status: { type: String, enum: ['active', 'inactive', 'terminated'], default: 'active' },
  },
  { timestamps: true, collection: 'staff' },
);
applyBase(staffSchema);
staffSchema.index({ clinicId: 1, userId: 1 }, { unique: true });
staffSchema.index({ clinicId: 1, staffType: 1, status: 1 });
staffSchema.index({ clinicId: 1, searchName: 1 });

export type Staff = InferSchemaType<typeof staffSchema>;
export type StaffDoc = HydratedDocument<Staff>;
export const StaffModel = model('Staff', staffSchema);
