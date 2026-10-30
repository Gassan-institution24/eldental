import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { phoneSchema } from '@/modules/users/user.model';

const workingHourSchema = new Schema(
  {
    weekday: { type: Number, min: 0, max: 6, required: true },
    open: { type: String, default: '09:00' },
    close: { type: String, default: '17:00' },
    closed: { type: Boolean, default: false },
  },
  { _id: false },
);

/** Jordan default: Saturday–Thursday 09:00–18:00, Friday closed. */
export function defaultWorkingHours() {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '09:00', close: '18:00', closed: weekday === 5 }));
}

const clinicSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    searchName: { type: String, index: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    logoFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    phone: { type: phoneSchema, default: undefined },
    email: String,
    address: {
      line1: String,
      cityId: { type: Schema.Types.ObjectId, ref: 'City' },
      countryId: { type: Schema.Types.ObjectId, ref: 'Country' },
      postalCode: String,
    },
    location: { lat: Number, lng: Number, radiusMeters: Number },
    taxNumber: String,
    commercialRegNo: String,
    timezone: { type: String, default: 'Asia/Amman' },
    currency: { type: String, default: 'JOD' },
    locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
    workingHours: { type: [workingHourSchema], default: defaultWorkingHours },
    settings: {
      numbering: {
        patient: { type: String, default: 'P' },
        invoice: { type: String, default: 'INV' },
        receipt: { type: String, default: 'RCPT' },
        appointment: { type: String, default: 'APT' },
        plan: { type: String, default: 'TP' },
        creditNote: { type: String, default: 'CN' },
      },
      cancellationWindowHours: { type: Number, default: 24 },
      noShowGraceMinutes: { type: Number, default: 15 },
      noShowAlertThreshold: { type: Number, default: 3 },
      onlineBookingEnabled: { type: Boolean, default: false },
      minOnlineLeadHours: { type: Number, default: 2 },
      maxOnlineDaysAhead: { type: Number, default: 60 },
      defaultAppointmentMinutes: { type: Number, default: 30 },
      reminderHours: { type: [Number], default: [24, 2] },
      vatRegistered: { type: Boolean, default: false },
      invoiceFooter: { type: String, default: '' },
      fiscalYearStartMonth: { type: Number, default: 1, min: 1, max: 12 },
      maxDiscountPercentWithoutApproval: { type: Number, default: 10 },
      postDiscountsNet: { type: Boolean, default: false },
      allowManualControlAccounts: { type: Boolean, default: false },
      manualJournalFourEyes: { type: Boolean, default: false },
      expenseApprovalThreshold: { type: Number, default: 100000 },
      payrollFourEyes: { type: Boolean, default: false },
      overtimeMultiplierBp: { type: Number, default: 12500 },
      overtimeRequiresApproval: { type: Boolean, default: false },
      attendanceSource: { type: String, enum: ['shift', 'dentistSchedule'], default: 'shift' },
      weekendDays: { type: [Number], default: [5] },
      consentMode: { type: String, enum: ['off', 'warn', 'strict'], default: 'warn' },
      consentCategories: { type: [String], default: ['oral_surgery', 'implants'] },
      incomeTax: {
        mode: { type: String, enum: ['none', 'brackets'], default: 'none' },
        brackets: { type: [{ upTo: Number, rateBp: Number, _id: false }], default: [] },
      },
      ssc: { employeeRateBp: { type: Number, default: 750 }, employerRateBp: { type: Number, default: 1425 }, capMonthly: { type: Number, default: 0 } },
      printLanguage: { type: String, enum: ['ar', 'en'], default: 'ar' },
    },
    integrations: {
      jofotara: {
        enabled: { type: Boolean, default: false },
        clientId: String,
        secretKeyEnc: { type: String, select: false },
        activityNumber: String,
        incomeSourceSequence: String,
      },
      whatsapp: { enabled: { type: Boolean, default: false }, senderName: String },
    },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan' },
    subscription: {
      status: { type: String, enum: ['trialing', 'active', 'past_due', 'suspended', 'cancelled'], default: 'trialing' },
      currentPeriodEnd: Date,
      trialEndsAt: Date,
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    onboarding: {
      completedSteps: { type: [String], default: [] },
      completedAt: Date,
    },
    permVersion: { type: Number, default: 1 },
  },
  { timestamps: true, collection: 'clinics' },
);
applyBase(clinicSchema, { tenant: false });
clinicSchema.index({ slug: 1 }, { unique: true });
clinicSchema.index({ status: 1 });

export type Clinic = InferSchemaType<typeof clinicSchema>;
export type ClinicDoc = HydratedDocument<Clinic>;
export const ClinicModel = model('Clinic', clinicSchema);

/** Mutations are blocked when the subscription is not active/trialing (10_FRONTEND.md §3). */
export function isClinicReadOnly(c: Pick<Clinic, 'status' | 'subscription'>): boolean {
  if (c.status === 'suspended') return true;
  const s = c.subscription?.status;
  return s === 'suspended' || s === 'cancelled';
}
