import { model, Schema } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';
import { COMM_CHANNELS, COMM_DIRECTIONS, COMM_OUTCOMES } from '@/shared/patients';

/** Calls, messages and visits about a patient, with optional follow-ups (03 §4). */
const communicationSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    at: { type: Date, required: true },
    channel: { type: String, enum: COMM_CHANNELS, required: true },
    direction: { type: String, enum: COMM_DIRECTIONS, required: true },
    summary: { type: String, required: true },
    outcome: { type: String, enum: COMM_OUTCOMES, required: true },
    followUpAt: Date,
    followUpDoneAt: Date,
    followUpDoneBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
  },
  { timestamps: true, collection: 'patientCommunications' },
);
applyBase(communicationSchema, { softDelete: false });
communicationSchema.index({ clinicId: 1, patientId: 1, at: -1 });
communicationSchema.index({ clinicId: 1, followUpAt: 1 });
export const CommunicationModel = model('PatientCommunication', communicationSchema);
