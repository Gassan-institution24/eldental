import { Schema, model, type InferSchemaType } from 'mongoose';
import { LOG_RETENTION } from './logRetention';

const systemErrorSchema = new Schema(
  {
    fingerprint: { type: String, required: true, unique: true },
    message: { type: String, required: true },
    code: String,
    name: String,
    stack: String,
    route: String,
    method: String,
    httpStatus: Number,
    reqId: String,
    lastReqIds: { type: [String], default: [] },
    sessionId: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic' },
    source: { type: String, enum: ['http', 'job', 'socket', 'integration'], default: 'http' },
    integration: { type: String, enum: ['whatsapp', 'jofotara', 'smtp', 'storage'] },
    occurrences: { type: Number, default: 1 },
    firstAt: { type: Date, default: () => new Date() },
    lastAt: { type: Date, default: () => new Date() },
    status: { type: String, enum: ['new', 'acknowledged', 'resolved'], default: 'new' },
    resolvedAt: Date,
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: String,
    lastNotifiedAt: Date,
  },
  { collection: 'systemErrors', versionKey: false },
);
systemErrorSchema.index({ lastAt: -1 });
systemErrorSchema.index({ status: 1, lastAt: -1 });
// Resolved errors expire one year after resolution; open ones are kept.
systemErrorSchema.index({ resolvedAt: 1 }, { expireAfterSeconds: LOG_RETENTION.systemErrorsAfterResolve });

export type SystemErrorDoc = InferSchemaType<typeof systemErrorSchema>;
export const SystemErrorModel = model('SystemError', systemErrorSchema);
