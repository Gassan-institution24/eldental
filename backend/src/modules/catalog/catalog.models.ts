import { Schema, model, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { PROCEDURE_CATEGORIES } from './procedureCatalog.seed';

const chartEffectSchema = new Schema(
  { setStatus: String, addCondition: String, removeConditions: { type: [String], default: undefined } },
  { _id: false },
);

/** Global procedure library (G). `name` null → shown via `seed.procedure.<code>`. */
const procedureCatalogSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, default: null },
    category: { type: String, enum: PROCEDURE_CATEGORIES, required: true },
    toothRequired: { type: Boolean, default: false },
    surfacesRequired: { type: Boolean, default: false },
    defaultDurationMin: { type: Number, default: 30 },
    suggestedPrice: { type: Number, default: 0 },
    labRequired: { type: Boolean, default: false },
    chartEffect: { type: chartEffectSchema, default: undefined },
    recall: { type: { type: String }, months: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'procedureCatalog' },
);
applyBase(procedureCatalogSchema, { tenant: false });
procedureCatalogSchema.index({ code: 1 }, { unique: true });
export type CatalogProcedure = InferSchemaType<typeof procedureCatalogSchema>;
export const ProcedureCatalogModel = model('ProcedureCatalog', procedureCatalogSchema);

const toothConditionSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, default: null },
    color: { type: String, default: '#94A3B8' },
    appliesTo: { type: String, enum: ['tooth', 'surface'], default: 'tooth' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'toothConditionsCatalog' },
);
applyBase(toothConditionSchema, { tenant: false });
toothConditionSchema.index({ code: 1 }, { unique: true });
export const ToothConditionModel = model('ToothCondition', toothConditionSchema);

const medicineSchema = new Schema(
  {
    name: { type: String, required: true },
    searchName: String,
    form: String,
    dose: String,
    frequency: String,
    days: Number,
    group: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'medicines' },
);
applyBase(medicineSchema, { tenant: false });
medicineSchema.index({ searchName: 1 });
export const MedicineModel = model('Medicine', medicineSchema);

/** Countries (G), managed by the platform (13 Phase 2). `code` is ISO 3166-1 alpha-2. */
const countrySchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    searchName: String,
    dialCode: { type: String, default: '' },
    currency: { type: String, uppercase: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'countries' },
);
applyBase(countrySchema, { tenant: false });
countrySchema.index({ code: 1 }, { unique: true });
export const CountryModel = model('Country', countrySchema);

const citySchema = new Schema(
  {
    countryCode: { type: String, required: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    searchName: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'cities' },
);
applyBase(citySchema, { tenant: false });
citySchema.index({ countryCode: 1, searchName: 1 });
export const CityModel = model('City', citySchema);

/** Currencies (G). `decimals` drives money input and display (JOD = 3). */
const currencySchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    searchName: String,
    symbol: { type: String, default: '' },
    decimals: { type: Number, min: 0, max: 4, default: 2 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'currencies' },
);
applyBase(currencySchema, { tenant: false });
currencySchema.index({ code: 1 }, { unique: true });
export const CurrencyModel = model('Currency', currencySchema);
