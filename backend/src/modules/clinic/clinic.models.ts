import { Schema, model, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';
import { PROCEDURE_CATEGORIES } from '@/modules/catalog/procedureCatalog.seed';

/** Chairs / operatories (03 §5). */
const chairSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    searchName: String,
    roomName: { type: String, default: '' },
    color: { type: String, default: '#4F46E5' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'chairs' },
);
applyBase(chairSchema);
chairSchema.index({ clinicId: 1, sortOrder: 1 });
export type Chair = InferSchemaType<typeof chairSchema>;
export const ChairModel = model('Chair', chairSchema);

/** Appointment types: default duration, colour, online flag, buffer (03 §5). */
const appointmentTypeSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, default: null },
    systemKey: String,
    searchName: String,
    code: { type: String, default: '' },
    defaultDurationMin: { type: Number, default: 30 },
    color: { type: String, default: '#4F46E5' },
    bufferAfterMin: { type: Number, default: 0 },
    allowOnline: { type: Boolean, default: false },
    requiresDeposit: { type: Boolean, default: false },
    defaultProcedureIds: [{ type: Schema.Types.ObjectId, ref: 'ClinicProcedure' }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'appointmentTypes' },
);
applyBase(appointmentTypeSchema);
export type AppointmentType = InferSchemaType<typeof appointmentTypeSchema>;
export const AppointmentTypeModel = model('AppointmentType', appointmentTypeSchema);

/** Clinic price list built from the global catalog or custom (03 §6). */
const clinicProcedureSchema = new Schema(
  {
    clinicId: tenantField,
    catalogId: { type: Schema.Types.ObjectId, ref: 'ProcedureCatalog' },
    code: { type: String, required: true },
    name: { type: String, default: null },
    systemKey: String,
    searchName: String,
    category: { type: String, enum: PROCEDURE_CATEGORIES, required: true },
    price: { type: Number, default: 0 },
    taxRateId: { type: Schema.Types.ObjectId, ref: 'TaxRate' },
    defaultDurationMin: { type: Number, default: 30 },
    toothRequired: { type: Boolean, default: false },
    surfacesRequired: { type: Boolean, default: false },
    labRequired: { type: Boolean, default: false },
    commissionEligible: { type: Boolean, default: true },
    chartEffect: { setStatus: String, addCondition: String, removeConditions: { type: [String], default: undefined } },
    recall: { type: { type: String }, months: Number },
    insurancePrices: { type: [{ insuranceCompanyId: { type: Schema.Types.ObjectId, ref: 'InsuranceCompany' }, price: Number, _id: false }], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'clinicProcedures' },
);
applyBase(clinicProcedureSchema);
clinicProcedureSchema.index({ clinicId: 1, code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
clinicProcedureSchema.index({ clinicId: 1, category: 1 });
export type ClinicProcedure = InferSchemaType<typeof clinicProcedureSchema>;
export const ClinicProcedureModel = model('ClinicProcedure', clinicProcedureSchema);

/** Tax rates in basis points (1600 = 16%), with JoFotara category (03 §8). */
const taxRateSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, default: null },
    systemKey: String,
    rate: { type: Number, required: true },
    jofotaraCategory: { type: String, enum: ['S', 'Z', 'O'], default: 'S' },
    outputAccountId: { type: Schema.Types.ObjectId, ref: 'Account' },
    inputAccountId: { type: Schema.Types.ObjectId, ref: 'Account' },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'taxRates' },
);
applyBase(taxRateSchema);
export type TaxRate = InferSchemaType<typeof taxRateSchema>;
export const TaxRateModel = model('TaxRate', taxRateSchema);
