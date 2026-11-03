import { Schema, model, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';

/**
 * Subscription plans for clinics (G, 03 §2). Prices are integer minor units of `currency`.
 * A limit of 0 means "unlimited".
 */
const planSchema = new Schema(
  {
    code: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    searchName: String,
    description: { type: String, default: '' },
    currency: { type: String, uppercase: true, default: 'JOD' },
    priceMonthly: { type: Number, default: 0 },
    priceYearly: { type: Number, default: 0 },
    trialDays: { type: Number, default: 30 },
    limits: {
      chairs: { type: Number, default: 0 },
      staff: { type: Number, default: 0 },
      patients: { type: Number, default: 0 },
      monthlyMessages: { type: Number, default: 0 },
      storageGb: { type: Number, default: 0 },
    },
    // Feature keys shown on the plan (e.g. "online_booking", "jofotara"); not enforced yet.
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'plans' },
);
applyBase(planSchema, { tenant: false });
planSchema.index({ code: 1 }, { unique: true });
export type Plan = InferSchemaType<typeof planSchema>;
export const PlanModel = model('Plan', planSchema);
