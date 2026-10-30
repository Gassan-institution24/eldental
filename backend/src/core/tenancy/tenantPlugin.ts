import { Schema, Types, type Aggregate, type Query } from 'mongoose';
import { requestContext } from '../context/requestContext';

export class TenantContextMissingError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant context missing for ${model}.${op} (use runInTenant or setOptions({ skipTenant: true }) in platform code)`);
    this.name = 'TenantContextMissingError';
  }
}

type TenantOpts = { skipTenant?: boolean; clinicId?: Types.ObjectId | string };

/** Runs `fn` with a tenant context (jobs, scripts, superadmin cross-tenant endpoints). */
export function runInTenant<T>(clinicId: Types.ObjectId | string, fn: () => T | PromiseLike<T>): Promise<T> {
  const parent = requestContext.get();
  // Awaited inside the scope: Mongoose queries are lazy and would otherwise run outside it.
  return requestContext.run({ ...parent, clinicId: String(clinicId), skipTenant: false }, async () => await fn());
}

/** Runs `fn` with tenant checks disabled. Only for platform services and migrations. */
export function runWithoutTenant<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  const parent = requestContext.get();
  return requestContext.run({ ...parent, skipTenant: true }, async () => await fn());
}

export function currentClinicId(): string | undefined {
  const c = requestContext.get()?.clinicId;
  return c ? String(c) : undefined;
}

function resolveClinic(opts: TenantOpts): { skip: boolean; clinicId?: Types.ObjectId } {
  if (opts.skipTenant) return { skip: true };
  const explicit = opts.clinicId;
  const ctx = requestContext.get();
  const raw = explicit ?? ctx?.clinicId;
  if (!raw) return { skip: Boolean(ctx?.skipTenant) };
  return { skip: false, clinicId: new Types.ObjectId(String(raw)) };
}

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'estimatedDocumentCount',
  'distinct',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'replaceOne',
] as const;

/**
 * Tenant plugin (02_ARCHITECTURE.md §5): adds `clinicId`, sets it on create, scopes every query
 * and aggregate to the current clinic, and throws when no tenant context exists.
 */
/** Declare in tenant schemas so `clinicId` is part of the inferred TS type. */
export const tenantField = { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true, immutable: true } as const;

export function tenantPlugin(schema: Schema): void {
  if (!schema.path('clinicId')) schema.add({ clinicId: tenantField });

  schema.pre('validate', function setClinic(next) {
    const doc = this as unknown as { clinicId?: Types.ObjectId; constructor: { modelName: string } };
    const { skip, clinicId } = resolveClinic({});
    if (!doc.clinicId) {
      if (!clinicId) {
        if (skip) return next();
        return next(new TenantContextMissingError(doc.constructor.modelName, 'save'));
      }
      doc.clinicId = clinicId;
    } else if (clinicId && !skip && !doc.clinicId.equals(clinicId)) {
      return next(new Error('Cross-tenant write rejected'));
    }
    next();
  });

  for (const op of QUERY_OPS) {
    schema.pre(op, function scopeQuery(this: Query<unknown, unknown>) {
      const opts = this.getOptions() as TenantOpts;
      const { skip, clinicId } = resolveClinic(opts);
      if (skip) return;
      if (!clinicId) throw new TenantContextMissingError(this.model.modelName, op);
      const filter = this.getFilter() as Record<string, unknown>;
      if (filter.clinicId && String(filter.clinicId) !== String(clinicId)) {
        // A query for another tenant can only ever match nothing.
        this.setQuery({ $and: [filter, { clinicId }] });
      } else {
        this.where({ clinicId });
      }
    });
  }

  schema.pre('aggregate', function scopeAggregate(this: Aggregate<unknown>) {
    const opts = this.options as TenantOpts;
    const { skip, clinicId } = resolveClinic(opts);
    if (skip) return;
    if (!clinicId) throw new TenantContextMissingError('aggregate', 'aggregate');
    const pipeline = this.pipeline();
    const first = pipeline[0] as Record<string, unknown> | undefined;
    // $geoNear/$search must be first; we keep them and match right after.
    const index = first && ('$geoNear' in first || '$search' in first) ? 1 : 0;
    pipeline.splice(index, 0, { $match: { clinicId } });
  });

  schema.pre('insertMany', function scopeInsert(next, docs: unknown) {
    const { skip, clinicId } = resolveClinic({});
    const list = (Array.isArray(docs) ? docs : [docs]) as { clinicId?: Types.ObjectId | string }[];
    for (const d of list) {
      if (!d.clinicId) {
        if (!clinicId) {
          if (skip) continue;
          return next(new TenantContextMissingError('insertMany', 'insertMany'));
        }
        d.clinicId = clinicId;
      } else if (clinicId && !skip && String(d.clinicId) !== String(clinicId)) {
        return next(new Error('Cross-tenant write rejected'));
      }
    }
    next();
  });
}
