import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

const ref = (name: string) => ({ type: Schema.Types.ObjectId, ref: name });

/* ---------- chart (07 §2) ---------- */

/** Current state per patient; `teeth` is keyed by FDI number as a string. */
const toothChartSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    dentition: { type: String, enum: ['permanent', 'primary', 'mixed'], default: 'permanent' },
    teeth: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'toothCharts', minimize: false },
);
applyBase(toothChartSchema);
toothChartSchema.index({ clinicId: 1, patientId: 1 }, { unique: true });
export type ToothState = { status: 'present' | 'missing' | 'implant' | 'unerupted'; conditions: { code: string; surfaces?: string[]; notedAt: Date; entryId: string; kind: string }[] };
export const ToothChartModel = model('ToothChart', toothChartSchema);

export const ENTRY_KINDS = ['existing', 'finding', 'planned', 'completed'] as const;
const chartEntrySchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    toothNumber: { type: Number, required: true },
    surfaces: { type: [String], default: [] },
    kind: { type: String, enum: ENTRY_KINDS, required: true },
    conditionCode: String,
    setStatus: String,
    clinicProcedureId: ref('ClinicProcedure'),
    performedProcedureId: ref('PerformedProcedure'),
    treatmentPlanId: ref('TreatmentPlan'),
    appointmentId: ref('Appointment'),
    staffId: ref('Staff'),
    notes: { type: String, default: '' },
    voidsEntryId: ref('ChartEntry'),
    voided: { type: Boolean, default: false },
    at: { type: Date, default: () => new Date() },
  },
  { collection: 'chartEntries', versionKey: false },
);
chartEntrySchema.index({ clinicId: 1, patientId: 1, toothNumber: 1, at: -1 });
applyBase(chartEntrySchema);
export type ChartEntry = InferSchemaType<typeof chartEntrySchema>;
export const ChartEntryModel = model('ChartEntry', chartEntrySchema);

/* ---------- treatment plans (07 §3) ---------- */

export const PLAN_STATUSES = ['draft', 'presented', 'accepted', 'partially_accepted', 'rejected', 'in_progress', 'completed', 'cancelled'] as const;
export const ITEM_STATUSES = ['proposed', 'accepted', 'rejected', 'scheduled', 'completed'] as const;

const planItemSchema = new Schema({
  phaseIndex: { type: Number, default: 0 },
  clinicProcedureId: { ...ref('ClinicProcedure'), required: true },
  code: String,
  category: String,
  toothNumbers: { type: [Number], default: [] },
  surfaces: { type: [String], default: [] },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  insuranceEstimate: { type: Number, default: 0 },
  patientEstimate: { type: Number, default: 0 },
  status: { type: String, enum: ITEM_STATUSES, default: 'proposed' },
  completedProcedureId: ref('PerformedProcedure'),
  appointmentId: ref('Appointment'),
  notes: { type: String, default: '' },
});

const treatmentPlanSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    number: { type: String, required: true },
    title: { type: String, default: '' },
    dentistId: { ...ref('Staff'), required: true },
    status: { type: String, enum: PLAN_STATUSES, default: 'draft' },
    phases: { type: [{ name: String, order: Number, _id: false }], default: [{ name: 'phase1', order: 0 }] },
    items: { type: [planItemSchema], default: [] },
    insurancePolicyId: ref('InsurancePolicy'),
    totals: { gross: { type: Number, default: 0 }, discount: { type: Number, default: 0 }, insurance: { type: Number, default: 0 }, patient: { type: Number, default: 0 } },
    alternativeGroupId: Schema.Types.ObjectId,
    alternativeLabel: { type: String, default: '' },
    presentedAt: Date,
    validUntil: String,
    acceptance: { at: Date, byPatient: Boolean, signatureFileId: ref('FileAsset'), ip: String, signerName: String },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'treatmentPlans', optimisticConcurrency: true },
);
applyBase(treatmentPlanSchema);
treatmentPlanSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
treatmentPlanSchema.index({ clinicId: 1, status: 1 });
export type TreatmentPlan = InferSchemaType<typeof treatmentPlanSchema>;
export type TreatmentPlanDoc = HydratedDocument<TreatmentPlan>;
export const TreatmentPlanModel = model('TreatmentPlan', treatmentPlanSchema);

/* ---------- performed procedures (07 §4) ---------- */

const performedSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    appointmentId: ref('Appointment'),
    treatmentPlanId: ref('TreatmentPlan'),
    treatmentPlanItemId: Schema.Types.ObjectId,
    clinicProcedureId: { ...ref('ClinicProcedure'), required: true },
    code: String,
    category: String,
    toothNumbers: { type: [Number], default: [] },
    surfaces: { type: [String], default: [] },
    dentistId: { ...ref('Staff'), required: true },
    assistantIds: { type: [Schema.Types.ObjectId], default: [] },
    performedAt: { type: Date, default: () => new Date() },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    status: { type: String, enum: ['completed', 'voided'], default: 'completed' },
    voidReason: String,
    voidedAt: Date,
    invoiceId: ref('Invoice'),
    invoiceLineRef: String,
    invoiceIssued: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'performedProcedures' },
);
applyBase(performedSchema);
performedSchema.index({ clinicId: 1, patientId: 1, performedAt: -1 });
performedSchema.index({ clinicId: 1, appointmentId: 1 });
performedSchema.index({ clinicId: 1, dentistId: 1, performedAt: -1 });
export type PerformedProcedure = InferSchemaType<typeof performedSchema>;
export const PerformedProcedureModel = model('PerformedProcedure', performedSchema);

/* ---------- notes (07 §5) ---------- */

const noteSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    appointmentId: ref('Appointment'),
    authorId: { ...ref('Staff'), required: true },
    templateId: ref('NoteTemplate'),
    format: { type: String, enum: ['soap', 'free'], default: 'soap' },
    content: { subjective: String, objective: String, assessment: String, plan: String },
    text: { type: String, default: '' },
    toothNumbers: { type: [Number], default: [] },
    signedAt: Date,
    amendsNoteId: ref('ClinicalNote'),
    amendedById: ref('ClinicalNote'),
  },
  { timestamps: true, collection: 'clinicalNotes', optimisticConcurrency: true },
);
applyBase(noteSchema);
noteSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
noteSchema.index({ clinicId: 1, authorId: 1, signedAt: 1 });
export const ClinicalNoteModel = model('ClinicalNote', noteSchema);

const noteTemplateSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    searchName: String,
    format: { type: String, enum: ['soap', 'free'], default: 'soap' },
    content: { subjective: String, objective: String, assessment: String, plan: String },
    text: { type: String, default: '' },
    appointmentTypeIds: { type: [Schema.Types.ObjectId], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'noteTemplates' },
);
applyBase(noteTemplateSchema);
export const NoteTemplateModel = model('NoteTemplate', noteTemplateSchema);

/* ---------- perio (07 §6) ---------- */

const perioSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    examDate: { type: String, required: true },
    examinerId: { ...ref('Staff'), required: true },
    teeth: { type: Schema.Types.Mixed, default: {} },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'perioCharts', minimize: false, optimisticConcurrency: true },
);
applyBase(perioSchema);
perioSchema.index({ clinicId: 1, patientId: 1, examDate: -1 });
export const PerioChartModel = model('PerioChart', perioSchema);

/* ---------- prescriptions (07 §7) ---------- */

const prescriptionSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    appointmentId: ref('Appointment'),
    dentistId: { ...ref('Staff'), required: true },
    number: { type: String, required: true },
    items: { type: [{ medicineId: Schema.Types.ObjectId, name: String, dose: String, route: String, frequency: String, durationDays: Number, instructions: String, _id: false }], default: [] },
    notes: { type: String, default: '' },
    printedAt: Date,
  },
  { timestamps: true, collection: 'prescriptions' },
);
applyBase(prescriptionSchema);
prescriptionSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
export const PrescriptionModel = model('Prescription', prescriptionSchema);

/* ---------- lab orders (07 §8) ---------- */

export const LAB_STATUSES = ['draft', 'sent', 'in_progress', 'received', 'fitted', 'remake', 'cancelled'] as const;
const labOrderSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    patientId: { ...ref('Patient'), required: true },
    dentistId: { ...ref('Staff'), required: true },
    labSupplierId: ref('Supplier'),
    labName: { type: String, default: '' },
    treatmentPlanId: ref('TreatmentPlan'),
    items: { type: [{ type: { type: String }, toothNumbers: [Number], material: String, shade: String, notes: String, _id: false }], default: [] },
    status: { type: String, enum: LAB_STATUSES, default: 'draft' },
    statusHistory: { type: [{ from: String, to: String, at: Date, reason: String, _id: false }], default: [] },
    sentAt: Date,
    dueDate: String,
    receivedAt: Date,
    fittedAt: Date,
    cost: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'labOrders', optimisticConcurrency: true },
);
applyBase(labOrderSchema);
labOrderSchema.index({ clinicId: 1, status: 1, dueDate: 1 });
labOrderSchema.index({ clinicId: 1, patientId: 1 });
export const LabOrderModel = model('LabOrder', labOrderSchema);

/* ---------- consents (07 §10) ---------- */

const consentTemplateSchema = new Schema(
  {
    clinicId: tenantField,
    title: { type: String, required: true },
    searchName: String,
    body: { type: String, required: true },
    procedureCategories: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'consentTemplates' },
);
applyBase(consentTemplateSchema);
export const ConsentTemplateModel = model('ConsentTemplate', consentTemplateSchema);

const consentSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { ...ref('Patient'), required: true },
    templateId: ref('ConsentTemplate'),
    title: String,
    renderedBody: { type: String, required: true },
    procedureCategories: { type: [String], default: [] },
    signedAt: { type: Date, required: true },
    signerName: String,
    signatureFileId: { ...ref('FileAsset'), required: true },
    witnessStaffId: ref('Staff'),
    appointmentId: ref('Appointment'),
  },
  { timestamps: true, collection: 'consents' },
);
applyBase(consentSchema);
consentSchema.index({ clinicId: 1, patientId: 1, signedAt: -1 });
export const ConsentModel = model('Consent', consentSchema);
