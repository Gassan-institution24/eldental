import { Schema, model, type InferSchemaType } from 'mongoose';

/** Append-only business audit trail (03 §3, 15 §1). No soft delete; kept permanently by default. */
const auditLogSchema = new Schema(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic' },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorStaffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    actorName: String,
    impersonatorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: {
      type: String,
      enum: [
        'create',
        'update',
        'delete',
        'restore',
        'status_change',
        'login',
        'logout',
        'login_failed',
        'export',
        'print',
        'impersonate',
        'permission_change',
        'access',
        'post',
        'reverse',
        'approve',
        'ownership_transfer',
      ],
      required: true,
    },
    entity: { type: String, required: true },
    entityId: String,
    summary: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    /** Resource key for field-rule filtering of the diff when viewing (04 §4.3). */
    resource: String,
    reason: String,
    ip: String,
    userAgent: String,
    reqId: String,
    sessionId: String,
    platformAccess: { type: Boolean, default: false },
    at: { type: Date, default: () => new Date() },
  },
  { collection: 'auditLogs', versionKey: false },
);
auditLogSchema.index({ clinicId: 1, at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });
auditLogSchema.index({ actorUserId: 1, at: -1 });
auditLogSchema.index({ sessionId: 1, at: 1 });
auditLogSchema.index({ action: 1, at: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
