import { Schema, model, type InferSchemaType } from 'mongoose';
import { LOG_RETENTION } from './logRetention';

const requestLogSchema = new Schema(
  {
    at: { type: Date, default: () => new Date() },
    reqId: String,
    sessionId: String,
    method: String,
    route: String,
    path: String,
    status: Number,
    durationMs: Number,
    errorCode: String,
    userId: { type: Schema.Types.ObjectId },
    staffId: { type: Schema.Types.ObjectId },
    clinicId: { type: Schema.Types.ObjectId },
    impersonatorUserId: { type: Schema.Types.ObjectId },
    ip: String,
    userAgent: String,
  },
  { collection: 'requestLogs', versionKey: false },
);
requestLogSchema.index({ at: 1 }, { expireAfterSeconds: LOG_RETENTION.requestLogs });
requestLogSchema.index({ clinicId: 1, at: -1 });
requestLogSchema.index({ userId: 1, at: -1 });
requestLogSchema.index({ sessionId: 1, at: 1 });
requestLogSchema.index({ reqId: 1 });

export type RequestLogDoc = InferSchemaType<typeof requestLogSchema>;
export const RequestLogModel = model('RequestLog', requestLogSchema);
