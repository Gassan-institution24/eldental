import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';
import { phoneSchema } from '@/modules/users/user.model';
import { BLOOD_TYPES, MARITAL_STATUSES, PATIENT_FLAGS, REFERRAL_TYPES } from '@/shared/patients';

const contactSchema = new Schema({ name: String, relation: String, phone: String }, { _id: false });

/** Patients (03 §4). Four-part name, one input per part, typed once. */
const patientSchema = new Schema(
  {
    clinicId: tenantField,
    fileNumber: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: {
      first: { type: String, required: true },
      father: String,
      grandfather: String,
      family: { type: String, required: true },
    },
    fullName: { type: String, required: true },
    searchName: { type: String, index: true },
    gender: { type: String, enum: ['male', 'female'] },
    dateOfBirth: String,
    nationalIdEnc: { type: String, select: false },
    nationalIdHash: String,
    nationalIdLast4: String,
    passportNo: String,
    phone: { type: phoneSchema, default: undefined },
    altPhone: { type: phoneSchema, default: undefined },
    email: { type: String, lowercase: true, trim: true },
    address: { line1: String, city: String },
    guardian: { patientId: { type: Schema.Types.ObjectId, ref: 'Patient' }, name: String, relation: String, phone: String },
    familyGroupId: { type: Schema.Types.ObjectId },
    emergencyContact: { type: contactSchema, default: undefined },
    referralSource: String,
    // Who referred the patient (03 §4); referralSource stays "how did you hear about us".
    referredBy: {
      type: { type: String, enum: REFERRAL_TYPES },
      patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
      name: String,
      note: String,
    },
    nationality: String,
    maritalStatus: { type: String, enum: MARITAL_STATUSES },
    occupation: String,
    bloodType: { type: String, enum: BLOOD_TYPES },
    heightCm: Number,
    weightKg: Number,
    legacyFileNumber: String,
    photoFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    idVerifiedAt: Date,
    idVerifiedBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    flags: { type: [{ code: { type: String, enum: PATIENT_FLAGS }, note: String, _id: false }], default: [] },
    preferredDentistId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    preferredLanguage: { type: String, enum: ['ar', 'en'], default: 'ar' },
    communicationPrefs: {
      whatsapp: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      email: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
    },
    medicalAlerts: { type: [String], default: [] },
    balance: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive', 'deceased', 'merged'], default: 'active' },
    mergedIntoId: { type: Schema.Types.ObjectId, ref: 'Patient' },
    lastVisitAt: Date,
    noShowCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'patients', optimisticConcurrency: true },
);
applyBase(patientSchema);
patientSchema.index({ clinicId: 1, fileNumber: 1 }, { unique: true });
patientSchema.index({ clinicId: 1, 'phone.e164': 1 });
patientSchema.index({ clinicId: 1, nationalIdHash: 1 });
patientSchema.index({ clinicId: 1, searchName: 1 });
patientSchema.index({ clinicId: 1, familyGroupId: 1 });
patientSchema.index({ clinicId: 1, createdAt: -1 });
// The old paper file number is unique per clinic when set.
patientSchema.index({ clinicId: 1, legacyFileNumber: 1 }, { unique: true, partialFilterExpression: { legacyFileNumber: { $type: 'string' } } });
patientSchema.index({ clinicId: 1, 'referredBy.patientId': 1 });

export type Patient = InferSchemaType<typeof patientSchema>;
export type PatientDoc = HydratedDocument<Patient>;
export const PatientModel = model('Patient', patientSchema);

/** Versioned medical history — a new document per update (03 §4). */
const medicalHistorySchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    version: { type: Number, required: true },
    answers: { type: Schema.Types.Mixed, default: {} },
    medications: { type: String, default: '' },
    medicationsList: {
      type: [{ name: String, medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine' }, dose: String, frequency: String, since: String, _id: false }],
      default: [],
    },
    surgeries: { type: [{ name: String, year: Number, note: String, _id: false }], default: [] },
    lifestyle: { smoking: { type: String, enum: ['none', 'former', 'light', 'heavy'] }, alcohol: { type: String, enum: ['none', 'light', 'heavy'] } },
    pregnancyWeeks: Number,
    allergies: { type: [{ substance: String, reaction: String, severity: { type: String, enum: ['mild', 'moderate', 'severe'] }, _id: false }], default: [] },
    notes: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    reviewedAt: Date,
    signedFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
  },
  { timestamps: true, collection: 'medicalHistories' },
);
applyBase(medicalHistorySchema, { softDelete: false });
medicalHistorySchema.index({ clinicId: 1, patientId: 1, version: -1 }, { unique: true });
export const MedicalHistoryModel = model('MedicalHistory', medicalHistorySchema);

/** Insurance companies (billing, 03 §7). */
const insuranceCompanySchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    searchName: String,
    code: { type: String, default: '' },
    contact: { phone: String, email: String, person: String },
    defaultCoveragePercent: { type: Number, default: 80 },
    coverageRules: { type: [{ procedureCategory: String, percent: Number, requiresPreApproval: Boolean, _id: false }], default: [] },
    payerAccountId: { type: Schema.Types.ObjectId, ref: 'Account' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'insuranceCompanies' },
);
applyBase(insuranceCompanySchema);
export const InsuranceCompanyModel = model('InsuranceCompany', insuranceCompanySchema);

const insurancePolicySchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    insuranceCompanyId: { type: Schema.Types.ObjectId, ref: 'InsuranceCompany', required: true },
    planName: { type: String, default: '' },
    memberNumber: { type: String, required: true },
    relationToSubscriber: { type: String, enum: ['self', 'spouse', 'child', 'other'], default: 'self' },
    validFrom: String,
    validTo: String,
    coveragePercentOverride: Number,
    annualMax: Number,
    usedThisYear: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'insurancePolicies' },
);
applyBase(insurancePolicySchema);
insurancePolicySchema.index({ clinicId: 1, patientId: 1 });
export const InsurancePolicyModel = model('InsurancePolicy', insurancePolicySchema);
