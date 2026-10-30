import { Schema, model, type InferSchemaType } from 'mongoose';
import { LOG_RETENTION } from './logRetention';

const shared = {
  at: { type: Date, default: () => new Date() },
  clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
  impersonatorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  sessionId: String,
  reqId: String,
  ip: String,
  userAgent: String,
  appVersion: String,
  locale: String,
};

/** User movements (15 §2). PII-free meta only. */
const activityLogSchema = new Schema(
  {
    ...shared,
    type: {
      type: String,
      enum: ['page_view', 'action', 'search', 'filter', 'download', 'session_start', 'session_end', 'clinic_switch', 'language_switch', 'api_action'],
      required: true,
    },
    route: String,
    entity: String,
    entityId: String,
    action: String,
    meta: Schema.Types.Mixed,
    durationMs: Number,
  },
  { collection: 'activityLogs', versionKey: false },
);
activityLogSchema.index({ at: 1 }, { expireAfterSeconds: LOG_RETENTION.activityLogs });
activityLogSchema.index({ clinicId: 1, at: -1 });
activityLogSchema.index({ userId: 1, at: -1 });
activityLogSchema.index({ sessionId: 1, at: 1 });

export type ActivityLog = InferSchemaType<typeof activityLogSchema>;
export const ActivityLogModel = model('ActivityLog', activityLogSchema);

/** Problems users hit, grouped by fingerprint (15 §2). */
const clientIssueSchema = new Schema(
  {
    ...shared,
    kind: {
      type: String,
      enum: ['js_error', 'api_error', 'validation_error', 'slow_page', 'offline', 'permission_denied', 'rage_click', 'user_report'],
      required: true,
    },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    message: String,
    code: String,
    route: String,
    component: String,
    stack: String,
    api: { method: String, path: String, status: Number, durationMs: Number, reqId: String },
    validation: { form: String, fields: { type: [{ field: String, rule: String, _id: false }], default: undefined } },
    userComment: String,
    screenshotFileId: { type: Schema.Types.ObjectId, ref: 'FileAsset' },
    context: Schema.Types.Mixed,
    status: { type: String, enum: ['new', 'acknowledged', 'resolved', 'ignored'], default: 'new' },
    fingerprint: { type: String, required: true },
    occurrences: { type: Number, default: 1 },
    usersAffected: { type: [Schema.Types.ObjectId], default: [] },
    firstAt: { type: Date, default: () => new Date() },
    lastAt: { type: Date, default: () => new Date() },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: String,
  },
  { collection: 'clientIssues', versionKey: false },
);
clientIssueSchema.index({ lastAt: 1 }, { expireAfterSeconds: LOG_RETENTION.clientIssues });
clientIssueSchema.index({ fingerprint: 1, clinicId: 1 });
clientIssueSchema.index({ clinicId: 1, lastAt: -1 });
clientIssueSchema.index({ sessionId: 1, at: 1 });
clientIssueSchema.index({ kind: 1, status: 1, lastAt: -1 });

export type ClientIssue = InferSchemaType<typeof clientIssueSchema>;
export const ClientIssueModel = model('ClientIssue', clientIssueSchema);
