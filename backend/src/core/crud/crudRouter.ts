import { Router, type Request } from 'express';
import type { Model, Types } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, noContent, ok, pageMeta } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize, withScope, type ScopeRule } from '@/core/rbac/authorize';
import { validate } from '@/core/validation/validate';
import { pageQuery, parseSort, skipOf } from '@/shared/pagination';
import { escapeRegex, toSearchName } from '@/shared/validation/normalize';
import { objectId } from '@/shared/validation/fields';

type Doc = Record<string, unknown> & { _id: Types.ObjectId; __v?: number };

export type CrudOptions<C extends ZodTypeAny, U extends ZodTypeAny> = {
  /** URL path, e.g. `/chairs`. */
  path: string;
  /** Audit entity name, e.g. `chair`. */
  entity: string;
  tag: string;
  model: Model<Record<string, unknown>>;
  perms: { read: string | string[]; create: string | string[]; update?: string | string[]; delete?: string | string[] };
  createSchema: C;
  updateSchema: U;
  /** Extra list filters (Zod object shape merged into the list query). */
  filters?: z.ZodRawShape;
  buildFilter?: (q: Record<string, unknown>, auth: AuthContext) => Record<string, unknown>;
  sortable: readonly string[];
  defaultSort?: Record<string, 1 | -1>;
  /** Field with a normalised `searchName` (set automatically from `searchFrom`). */
  searchFrom?: (body: Record<string, unknown>) => string | undefined;
  scope?: ScopeRule;
  toDto?: (doc: Doc) => Record<string, unknown>;
  /** Maps validated input to stored fields (encryption, derived values…). */
  toModel?: (body: Record<string, unknown>, auth: AuthContext, existing?: Doc) => Promise<Record<string, unknown>> | Record<string, unknown>;
  beforeDelete?: (doc: Doc, auth: AuthContext) => Promise<void>;
  afterWrite?: (doc: Doc, auth: AuthContext, kind: 'create' | 'update' | 'delete') => Promise<void>;
  /** Default `true`: deletes set `deletedAt`. */
  softDelete?: boolean;
  /** List without pagination (small reference lists like chairs). */
  unpaged?: boolean;
};

export function defaultDto(d: Doc): Record<string, unknown> {
  const { _id, __v, clinicId: _c, deletedAt: _d, deletedBy: _db, searchName: _s, ...rest } = d;
  return { id: String(_id), version: __v ?? 0, ...rest };
}

const arr = (p: string | string[]) => (Array.isArray(p) ? p : [p]);
const idParams = z.object({ id: objectId() });

/**
 * Standard tenant CRUD (05 §7): list (paged, sorted, searched), get, create, PATCH with
 * `version` (409 on conflict), soft delete — all authorized, validated and audited.
 */
export function crudRouter<C extends ZodTypeAny, U extends ZodTypeAny>(o: CrudOptions<C, U>): Router {
  const r = Router();
  const toDto = o.toDto ?? defaultDto;
  const listQuery = z.object({ ...pageQuery, ...(o.filters ?? {}), includeInactive: z.enum(['true', 'false']).optional() }).strict();
  const scoped = (req: Request, extra: Record<string, unknown>) => (o.scope ? withScope(req.auth!, o.scope, extra) : extra);

  r.get(
    o.path,
    authorize(...arr(o.perms.read)),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.valid.query as Record<string, unknown> & { page: number; limit: number; sort?: string; q?: string };
      const filter: Record<string, unknown> = { ...(o.buildFilter?.(q, req.auth!) ?? {}) };
      if (q.q && o.searchFrom) filter.searchName = { $regex: escapeRegex(toSearchName(q.q)) };
      const finalFilter = scoped(req, filter);
      const sort = parseSort(q.sort, o.sortable, o.defaultSort ?? { createdAt: -1 });
      if (o.unpaged) {
        const items = await o.model.find(finalFilter).sort(sort).limit(500).lean();
        return ok(res, (items as Doc[]).map(toDto));
      }
      const [items, total] = await Promise.all([
        o.model.find(finalFilter).sort(sort).skip(skipOf(q)).limit(q.limit).lean(),
        o.model.countDocuments(finalFilter),
      ]);
      ok(res, (items as Doc[]).map(toDto), pageMeta(q.page, q.limit, total));
    }),
  );

  r.get(
    `${o.path}/:id`,
    authorize(...arr(o.perms.read)),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await o.model.findOne(scoped(req, { _id: (req.valid.params as { id: string }).id })).lean();
      if (!doc) throw ApiError.notFound();
      ok(res, toDto(doc as Doc));
    }),
  );

  r.post(
    o.path,
    authorize(...arr(o.perms.create)),
    validate({ body: o.createSchema }),
    asyncHandler(async (req, res) => {
      const body = req.valid.body as Record<string, unknown>;
      const data = o.toModel ? await o.toModel(body, req.auth!) : body;
      const search = o.searchFrom?.(body);
      const doc = await new o.model({ ...data, ...(search ? { searchName: toSearchName(search) } : {}) }).save();
      const plain = doc.toObject() as Doc;
      await recordAudit({ action: 'create', entity: o.entity, entityId: plain._id, after: plain });
      await o.afterWrite?.(plain, req.auth!, 'create');
      created(res, toDto(plain), `${o.path}/${String(plain._id)}`);
    }),
  );

  r.patch(
    `${o.path}/:id`,
    authorize(...arr(o.perms.update ?? o.perms.create)),
    validate({ params: idParams, body: o.updateSchema }),
    asyncHandler(async (req, res) => {
      const { version, ...body } = req.valid.body as Record<string, unknown> & { version: number };
      const doc = await o.model.findOne(scoped(req, { _id: (req.valid.params as { id: string }).id }));
      if (!doc) throw ApiError.notFound();
      const before = doc.toObject() as Doc;
      if ((before.__v ?? 0) !== version) throw ApiError.conflict('VERSION_CONFLICT', 'The record was changed by someone else.');
      const data = o.toModel ? await o.toModel(body, req.auth!, before) : body;
      for (const [k, v] of Object.entries(data)) doc.set(k, v === null ? undefined : v);
      const search = o.searchFrom?.({ ...before, ...body });
      if (search) doc.set('searchName', toSearchName(search));
      doc.increment();
      await doc.save();
      const after = doc.toObject() as Doc;
      await recordAudit({ action: 'update', entity: o.entity, entityId: after._id, before, after });
      await o.afterWrite?.(after, req.auth!, 'update');
      ok(res, toDto(after));
    }),
  );

  r.delete(
    `${o.path}/:id`,
    authorize(...arr(o.perms.delete ?? o.perms.update ?? o.perms.create)),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await o.model.findOne(scoped(req, { _id: (req.valid.params as { id: string }).id }));
      if (!doc) throw ApiError.notFound();
      const plain = doc.toObject() as Doc;
      await o.beforeDelete?.(plain, req.auth!);
      if (o.softDelete === false) await doc.deleteOne();
      else await (doc as unknown as { softDelete: () => Promise<unknown> }).softDelete();
      await recordAudit({ action: 'delete', entity: o.entity, entityId: plain._id, before: plain });
      await o.afterWrite?.(plain, req.auth!, 'delete');
      noContent(res);
    }),
  );

  r.post(
    `${o.path}/:id/restore`,
    authorize(...arr(o.perms.delete ?? o.perms.update ?? o.perms.create)),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await o.model.findOne(scoped(req, { _id: (req.valid.params as { id: string }).id })).setOptions({ withDeleted: true });
      if (!doc) throw ApiError.notFound();
      await (doc as unknown as { restore: () => Promise<unknown> }).restore();
      await recordAudit({ action: 'restore', entity: o.entity, entityId: String(doc._id) });
      ok(res, toDto(doc.toObject() as Doc));
    }),
  );

  registerPath({ method: 'get', path: o.path, tags: [o.tag], summary: `List ${o.entity}`, query: listQuery });
  registerPath({ method: 'post', path: o.path, tags: [o.tag], summary: `Create ${o.entity}`, body: o.createSchema });
  registerPath({ method: 'patch', path: `${o.path}/:id`, tags: [o.tag], summary: `Update ${o.entity}`, params: idParams, body: o.updateSchema });
  registerPath({ method: 'delete', path: `${o.path}/:id`, tags: [o.tag], summary: `Delete ${o.entity}`, params: idParams });
  return r;
}

/** `update` schema = partial create + required `version`. */
export function updateOf<S extends z.ZodRawShape>(shape: S) {
  return z.object(shape).partial().extend({ version: z.number().int().min(0) }).strict();
}
