import { model, Schema } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

/**
 * Post-treatment instruction templates. Seeded ones have a `systemKey` and no name/body, so they
 * show in the UI language (`seed.instruction.<key>`) until the clinic edits them (07 §15).
 */
const templateSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, default: null },
    searchName: String,
    body: { type: String, default: null },
    systemKey: String,
    procedureCodes: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'instructionTemplates' },
);
applyBase(templateSchema);
templateSchema.index({ clinicId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } });
export const InstructionTemplateModel = model('InstructionTemplate', templateSchema);

/** Instructions given to a patient: the text is a snapshot, later template edits don't change it. */
const givenSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'InstructionTemplate' },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    title: { type: String, required: true },
    body: { type: String, required: true },
    givenBy: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    givenAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'patientInstructions' },
);
applyBase(givenSchema, { softDelete: false });
givenSchema.index({ clinicId: 1, patientId: 1, givenAt: -1 });
export const PatientInstructionModel = model('PatientInstruction', givenSchema);

/** Seeded defaults and the procedure codes each one is suggested for. */
export const DEFAULT_INSTRUCTIONS: { systemKey: string; procedureCodes: string[] }[] = [
  { systemKey: 'extraction', procedureCodes: ['D7140', 'D7210', 'D7220', 'D7240', 'D7250'] },
  { systemKey: 'filling', procedureCodes: ['D2140', 'D2150', 'D2160', 'D2330', 'D2331', 'D2332', 'D2335', 'D2391', 'D2392', 'D2393', 'D2394'] },
  { systemKey: 'root_canal', procedureCodes: ['D3310', 'D3320', 'D3330', 'D3346'] },
  { systemKey: 'scaling', procedureCodes: ['D1110', 'D1120', 'D4341', 'D4342', 'D4355'] },
  { systemKey: 'braces', procedureCodes: ['D8010', 'D8080', 'D8090', 'D8090A', 'D8670'] },
  { systemKey: 'dentures', procedureCodes: ['D5110', 'D5120', 'D5213', 'D5214'] },
  { systemKey: 'whitening', procedureCodes: ['D9972'] },
];
