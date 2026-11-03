import { model, Schema } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';
import { CERTIFICATE_TYPES } from '@/shared/patients';

/** Issued certificates are immutable; the only change allowed is voiding them (07 §14). */
const MUTABLE = new Set(['status', 'voidReason', 'voidedAt', 'voidedBy', 'printedAt', 'updatedAt', 'updatedBy']);

const certificateSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    type: { type: String, enum: CERTIFICATE_TYPES, required: true },
    dentistId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    from: { type: String, required: true },
    to: { type: String, required: true },
    days: { type: Number, required: true },
    diagnosis: String,
    body: { type: String, required: true },
    recommendations: String,
    issuedAt: { type: Date, required: true },
    status: { type: String, enum: ['issued', 'void'], default: 'issued' },
    voidReason: String,
    voidedAt: Date,
    voidedBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    printedAt: Date,
  },
  { timestamps: true, collection: 'medicalCertificates' },
);
applyBase(certificateSchema, { softDelete: false });
certificateSchema.index({ clinicId: 1, number: 1 }, { unique: true });
certificateSchema.index({ clinicId: 1, patientId: 1, issuedAt: -1 });
certificateSchema.pre('save', function guard(next) {
  if (this.isNew) return next();
  const changed = this.modifiedPaths().filter((p) => !MUTABLE.has(p));
  next(changed.length ? new Error(`Issued certificates are immutable (${changed.join(', ')})`) : undefined);
});
export const CertificateModel = model('MedicalCertificate', certificateSchema);
