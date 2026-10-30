import { Schema, Types, type Query } from 'mongoose';
import { requestContext } from '../context/requestContext';
import { tenantPlugin } from '../tenancy/tenantPlugin';

function actorId(): Types.ObjectId | undefined {
  const u = requestContext.get()?.userId;
  return u && Types.ObjectId.isValid(String(u)) ? new Types.ObjectId(String(u)) : undefined;
}

/** `createdBy` / `updatedBy` from the request context. */
export function auditFieldsPlugin(schema: Schema): void {
  schema.add({
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  });
  schema.pre('save', function setActors(next) {
    const doc = this as unknown as { isNew: boolean; createdBy?: Types.ObjectId; updatedBy?: Types.ObjectId };
    const actor = actorId();
    if (actor) {
      if (doc.isNew && !doc.createdBy) doc.createdBy = actor;
      doc.updatedBy = actor;
    }
    next();
  });
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate'] as const) {
    schema.pre(op, function setUpdater(this: Query<unknown, unknown>) {
      const actor = actorId();
      if (actor) this.set({ updatedBy: actor });
    });
  }
}

type SoftOpts = { withDeleted?: boolean };

/** Soft delete everywhere (01_PRD §6): default queries exclude deleted documents. */
export function softDeletePlugin(schema: Schema): void {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  });
  const ops = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany', 'distinct'] as const;
  for (const op of ops) {
    schema.pre(op, function excludeDeleted(this: Query<unknown, unknown>) {
      const opts = this.getOptions() as SoftOpts;
      const filter = this.getFilter() as Record<string, unknown>;
      if (opts.withDeleted || 'deletedAt' in filter) return;
      this.where({ deletedAt: null });
    });
  }
  schema.pre('aggregate', function excludeDeletedAgg() {
    const opts = this.options as SoftOpts;
    if (opts.withDeleted) return;
    const pipeline = this.pipeline();
    const idx = pipeline.findIndex((s) => !('$match' in s && 'clinicId' in ((s as { $match: object }).$match ?? {})));
    pipeline.splice(idx < 0 ? pipeline.length : idx, 0, { $match: { deletedAt: null } });
  });
  schema.method('softDelete', function softDelete(this: { deletedAt: Date | null; deletedBy?: Types.ObjectId; save: () => Promise<unknown> }) {
    this.deletedAt = new Date();
    this.deletedBy = actorId();
    return this.save();
  });
  schema.method('restore', function restore(this: { deletedAt: Date | null; deletedBy?: Types.ObjectId; save: () => Promise<unknown> }) {
    this.deletedAt = null;
    this.deletedBy = undefined;
    return this.save();
  });
}

/** Exposes `__v` as `version` and `_id` as `id` in JSON (05_API_CONVENTIONS.md §5). */
export function jsonPlugin(schema: Schema): void {
  schema.set('toJSON', {
    virtuals: false,
    versionKey: false,
    transform(_doc, ret: Record<string, unknown>) {
      ret.id = String(ret._id);
      ret.version = ret.__v;
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  });
}

type BaseOptions = { tenant?: boolean; softDelete?: boolean; audit?: boolean };

/** Applies the base plugins every model gets (03_DATA_MODEL.md header). */
export function applyBase(schema: Schema, opts: BaseOptions = {}): Schema {
  if (opts.tenant !== false) schema.plugin(tenantPlugin);
  if (opts.audit !== false) schema.plugin(auditFieldsPlugin);
  if (opts.softDelete !== false) schema.plugin(softDeletePlugin);
  schema.plugin(jsonPlugin);
  return schema;
}

export type SoftDeleteMethods = { softDelete(): Promise<unknown>; restore(): Promise<unknown> };
