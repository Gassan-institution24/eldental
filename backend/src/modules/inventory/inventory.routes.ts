import { Router } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { crudRouter, defaultDto, updateOf } from '@/core/crud/crudRouter';
import { nextNumber } from '@/core/db/sequence';
import { withTransaction } from '@/core/db/transaction';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { body, params, query, validate } from '@/core/validation/validate';
import { clinicToday } from '@/modules/accounting/journal.service';
import { ChairModel, ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import {
  adjustmentBody,
  containerCount,
  containerDiscardBody,
  containerOpenBody,
  containerTransferBody,
  costOf,
  itemCreateBody,
  locationBody,
  MOVEMENT_TYPES,
  openingStockBody,
  procedureMaterialsBody,
  roundQty,
  transferBody,
  type ContainerPolicy,
} from '@/shared/inventory';
import { enumOf, objectId, optional } from '@/shared/validation/fields';
import { postInventoryEntry } from './inventory.accounts';
import {
  ContainerEventModel,
  InventoryBatchModel,
  InventoryContainerModel,
  InventoryItemModel,
  InventoryLocationModel,
  ProcedureMaterialModel,
  StockAdjustmentModel,
  StockBalanceModel,
  StockMovementModel,
  StockTransferModel,
} from './inventory.models';
import { canSeeCost, loadBatch, loadItem, loadLocation, move, notifyLowStockAfterCommit, once, sess, type StockCtx } from './stock.service';

/** Inventory: catalog, locations, stock, transfers, adjustments, containers (08b). */
export const inventoryRouter = Router();

const idParams = z.object({ id: objectId() });
const STOCK_READ = ['inventory.item.read', 'inventory.usage.record'] as const;
const idOf = (v: unknown) => (v ? String(v) : undefined);
const key = (req: { header: (h: string) => string | undefined }) => req.header('idempotency-key')?.slice(0, 100) || undefined;

export async function stockCtx(auth: AuthContext, session?: ClientSession): Promise<StockCtx> {
  return { auth, session, date: await clinicToday(), lowStock: new Set() };
}

/* ---------- items ---------- */

/** Fields that define how stock is counted; frozen once the item has stock or history. */
const UNIT_FIELDS = ['unit', 'unitsPerPack', 'trackContainers', 'containerPolicy', 'containerCapacity'] as const;

inventoryRouter.use(
  crudRouter({
    path: '/inventory-items',
    entity: 'inventoryItem',
    tag: 'inventory',
    model: InventoryItemModel as never,
    perms: { read: [...STOCK_READ], create: 'inventory.item.manage' },
    createSchema: itemCreateBody,
    updateSchema: updateOf(itemCreateBody.innerType().shape),
    filters: { low: z.enum(['true', 'false']).optional(), type: optional(z.string().max(20)) },
    buildFilter: (q) => ({
      ...(q.includeInactive === 'true' ? {} : { isActive: true }),
      ...(q.type ? { type: q.type } : {}),
      ...(q.low === 'true' ? { reorderLevel: { $gt: 0 }, $expr: { $lte: ['$quantityOnHand', '$reorderLevel'] } } : {}),
    }),
    sortable: ['name', 'sku', 'quantityOnHand', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => [b.name, b.sku, b.category].filter(Boolean).join(' '),
    unpaged: true,
    toModel: async (b, _auth, existing) => {
      const out: Record<string, unknown> = { ...b };
      if (!out.trackContainers) delete out.containerCapacity;
      if (existing) {
        const merged = { ...existing, ...b };
        const check = itemCreateBody.safeParse({
          name: merged.name,
          unit: merged.unit,
          type: merged.type,
          unitsPerPack: merged.unitsPerPack,
          trackContainers: merged.trackContainers,
          containerPolicy: merged.containerPolicy,
          ...(merged.containerCapacity ? { containerCapacity: merged.containerCapacity } : {}),
        });
        if (!check.success) throw ApiError.validation(check.error.issues.map((i) => ({ path: i.path.join('.'), code: i.message })));
        const changed = UNIT_FIELDS.filter((f) => f in b && b[f] !== existing[f]);
        if (changed.length && ((existing.quantityOnHand as number) > 0 || (await InventoryBatchModel.exists({ itemId: existing._id })))) {
          throw ApiError.conflict('ITEM_HAS_STOCK', 'Units and container rules are fixed once the item has stock', { fields: changed });
        }
      }
      if (out.trackContainers && !out.containerCapacity && existing?.containerCapacity === undefined) out.containerCapacity = out.unitsPerPack ?? existing?.unitsPerPack;
      return out;
    },
    beforeDelete: async (doc) => {
      if (((doc.quantityOnHand as number) ?? 0) > 0) throw ApiError.conflict('ITEM_HAS_STOCK', 'Issue or discard the remaining stock first');
    },
  }),
);

/* ---------- locations ---------- */

inventoryRouter.use(
  crudRouter({
    path: '/inventory-locations',
    entity: 'inventoryLocation',
    tag: 'inventory',
    model: InventoryLocationModel as never,
    perms: { read: [...STOCK_READ], create: 'inventory.item.manage' },
    createSchema: locationBody,
    updateSchema: updateOf(locationBody.innerType().shape),
    buildFilter: (q) => (q.includeInactive === 'true' ? {} : { isActive: true }),
    sortable: ['name', 'type', 'createdAt'],
    defaultSort: { name: 1 },
    unpaged: true,
    toModel: async (b, _auth, existing) => {
      const type = (b.type ?? existing?.type) as string;
      const chairId = (b.chairId ?? existing?.chairId) as string | undefined;
      if (type === 'chair') {
        if (!chairId) throw ApiError.validation([{ path: 'chairId', code: 'required' }]);
        if (!(await ChairModel.exists({ _id: chairId }))) throw ApiError.validation([{ path: 'chairId', code: 'not_found' }]);
      }
      return { ...b, ...(type !== 'chair' ? { chairId: undefined } : {}) };
    },
    afterWrite: async (doc, _auth, kind) => {
      // One default warehouse per clinic.
      if (kind !== 'delete' && doc.isDefault) await InventoryLocationModel.updateMany({ _id: { $ne: doc._id }, isDefault: true }, { $set: { isDefault: false } });
    },
    beforeDelete: async (doc) => {
      if (await StockBalanceModel.exists({ locationId: doc._id, quantity: { $gt: 0 } })) throw ApiError.conflict('ITEM_HAS_STOCK', 'Move the stock out of this location first');
    },
  }),
);

/* ---------- stock views ---------- */

const balancesQuery = z
  .object({ itemId: optional(objectId()), locationId: optional(objectId()), available: z.enum(['true', 'false']).optional() })
  .strict();

/** Balances per location and lot. `available=true` hides expired lots (for consumption pickers). */
inventoryRouter.get(
  '/inventory/balances',
  authorize(...STOCK_READ),
  validate({ query: balancesQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, balancesQuery);
    const rows = await StockBalanceModel.find({ quantity: { $gt: 0 }, ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.locationId ? { locationId: q.locationId } : {}) })
      .limit(5000)
      .lean();
    const [items, batches, locations] = await Promise.all([
      InventoryItemModel.find({ _id: { $in: rows.map((r) => r.itemId) } }).select('name unit sku trackContainers').lean(),
      InventoryBatchModel.find({ _id: { $in: rows.map((r) => r.batchId) } }).lean(),
      InventoryLocationModel.find({ _id: { $in: rows.map((r) => r.locationId) } }).select('name type').lean(),
    ]);
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    const batchById = new Map(batches.map((b) => [String(b._id), b]));
    const locById = new Map(locations.map((l) => [String(l._id), l]));
    const today = await clinicToday();
    const cost = canSeeCost(req.auth!);
    const out = rows
      .map((r) => {
        const it = itemById.get(String(r.itemId));
        const b = batchById.get(String(r.batchId));
        const l = locById.get(String(r.locationId));
        const expired = Boolean(b?.expiresAt && b.expiresAt < today);
        return {
          id: String(r._id),
          itemId: String(r.itemId),
          itemName: it?.name ?? '',
          sku: it?.sku ?? '',
          unit: it?.unit ?? '',
          trackContainers: Boolean(it?.trackContainers),
          locationId: String(r.locationId),
          locationName: l?.name ?? '',
          locationType: l?.type,
          batchId: String(r.batchId),
          lotNumber: b?.lotNumber ?? '',
          expiresAt: b?.expiresAt,
          expired,
          quantity: r.quantity,
          ...(cost && b ? { value: costOf(r.quantity, b.packCost, b.unitsPerPack) } : {}),
        };
      })
      .filter((r) => q.available !== 'true' || !r.expired)
      // First-expiry-first-out: soonest expiry first, then lot.
      .sort((a, b) => a.itemName.localeCompare(b.itemName) || (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999') || a.lotNumber.localeCompare(b.lotNumber));
    ok(res, out);
  }),
);

const movementsQuery = z
  .object({
    itemId: optional(objectId()),
    locationId: optional(objectId()),
    type: optional(enumOf([...MOVEMENT_TYPES])),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

inventoryRouter.get(
  '/inventory/movements',
  authorize('inventory.item.read'),
  validate({ query: movementsQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, movementsQuery);
    const filter: Record<string, unknown> = { ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.type ? { type: q.type } : {}) };
    if (q.locationId) filter.$or = [{ fromLocationId: q.locationId }, { toLocationId: q.locationId }];
    const rows = await StockMovementModel.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean();
    const [items, batches, locations] = await Promise.all([
      InventoryItemModel.find({ _id: { $in: rows.map((r) => r.itemId) } }).select('name unit').lean(),
      InventoryBatchModel.find({ _id: { $in: rows.map((r) => r.batchId) } }).select('lotNumber').lean(),
      InventoryLocationModel.find({ _id: { $in: rows.flatMap((r) => [r.fromLocationId, r.toLocationId].filter(Boolean)) } }).select('name').lean(),
    ]);
    const name = new Map([...items, ...locations].map((d) => [String(d._id), d.name]));
    const unit = new Map(items.map((i) => [String(i._id), i.unit]));
    const lot = new Map(batches.map((b) => [String(b._id), b.lotNumber]));
    const cost = canSeeCost(req.auth!);
    ok(
      res,
      rows.map((r) => ({
        id: String(r._id),
        type: r.type,
        date: r.date,
        at: r.createdAt,
        itemId: String(r.itemId),
        itemName: name.get(String(r.itemId)) ?? '',
        unit: unit.get(String(r.itemId)) ?? '',
        lotNumber: lot.get(String(r.batchId)) ?? '',
        quantity: r.quantity,
        fromLocationName: r.fromLocationId ? name.get(String(r.fromLocationId)) : undefined,
        toLocationName: r.toLocationId ? name.get(String(r.toLocationId)) : undefined,
        sourceType: r.sourceType,
        sourceId: String(r.sourceId),
        containerId: idOf(r.containerId),
        ...(cost ? { cost: r.cost } : {}),
      })),
    );
  }),
);

/** Dashboard: low stock, expiring lots, containers near their beyond-use date, value. */
inventoryRouter.get(
  '/inventory/overview',
  authorize('inventory.item.read'),
  asyncHandler(async (req, res) => {
    const today = await clinicToday();
    const soon = new Date(`${today}T00:00:00Z`);
    soon.setUTCDate(soon.getUTCDate() + 60);
    const in60 = soon.toISOString().slice(0, 10);
    const week = new Date(`${today}T00:00:00Z`);
    week.setUTCDate(week.getUTCDate() + 7);
    const in7 = week.toISOString().slice(0, 10);
    const [itemCount, low, balances, openContainers] = await Promise.all([
      InventoryItemModel.countDocuments({ isActive: true }),
      InventoryItemModel.find({ isActive: true, reorderLevel: { $gt: 0 }, $expr: { $lte: ['$quantityOnHand', '$reorderLevel'] } }).select('name unit quantityOnHand reorderLevel').sort({ name: 1 }).limit(50).lean(),
      StockBalanceModel.find({ quantity: { $gt: 0 } }).limit(10000).lean(),
      InventoryContainerModel.find({ status: 'open' }).select('code itemId beyondUseDate remainingQuantity locationId').lean(),
    ]);
    const batches = await InventoryBatchModel.find({ _id: { $in: [...new Set(balances.map((b) => String(b.batchId)))] } }).lean();
    const batchById = new Map(batches.map((b) => [String(b._id), b]));
    const qtyByBatch = new Map<string, number>();
    let value = 0;
    for (const b of balances) {
      const batch = batchById.get(String(b.batchId));
      qtyByBatch.set(String(b.batchId), roundQty((qtyByBatch.get(String(b.batchId)) ?? 0) + b.quantity));
      if (batch) value += costOf(b.quantity, batch.packCost, batch.unitsPerPack);
    }
    const expiringBatches = batches.filter((b) => b.expiresAt && b.expiresAt <= in60).sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
    const nearBud = openContainers.filter((c) => c.beyondUseDate && c.beyondUseDate <= in7);
    const itemNames = new Map(
      (await InventoryItemModel.find({ _id: { $in: [...expiringBatches.map((b) => b.itemId), ...nearBud.map((c) => c.itemId)] } }).select('name unit').lean()).map((i) => [String(i._id), i]),
    );
    ok(res, {
      today,
      items: itemCount,
      lowStock: low.map((i) => ({ id: String(i._id), name: i.name, unit: i.unit, quantityOnHand: i.quantityOnHand, reorderLevel: i.reorderLevel })),
      expiring: expiringBatches.slice(0, 50).map((b) => ({
        batchId: String(b._id),
        itemId: String(b.itemId),
        itemName: itemNames.get(String(b.itemId))?.name ?? '',
        unit: itemNames.get(String(b.itemId))?.unit ?? '',
        lotNumber: b.lotNumber,
        expiresAt: b.expiresAt,
        expired: (b.expiresAt ?? '') < today,
        quantity: qtyByBatch.get(String(b._id)) ?? 0,
      })),
      openContainers: openContainers.length,
      containersNearBeyondUse: nearBud.map((c) => ({ id: String(c._id), code: c.code, itemName: itemNames.get(String(c.itemId))?.name ?? '', beyondUseDate: c.beyondUseDate, remainingQuantity: c.remainingQuantity, expired: (c.beyondUseDate ?? '') < today })),
      ...(canSeeCost(req.auth!) ? { stockValue: value } : {}),
    });
  }),
);

/* ---------- transfers ---------- */

async function assertNotContainerTracked(item: { trackContainers?: boolean | null }, i: number) {
  if (item.trackContainers) throw ApiError.conflict('CONTAINER_REQUIRED', 'Move or discard tracked containers one by one', { line: i });
}

inventoryRouter.post(
  '/inventory/transfers',
  authorize('inventory.stock.adjust'),
  validate({ body: transferBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, transferBody);
    const auth = req.auth!;
    const doc = await once(
      key(req),
      (k) => StockTransferModel.findOne({ idempotencyKey: k }).lean<Record<string, unknown>>(),
      () =>
        withTransaction(async (session) => {
          const ctx = await stockCtx(auth, session);
          const [from, to] = [await loadLocation(ctx, b.fromLocationId, 'fromLocationId'), await loadLocation(ctx, b.toLocationId, 'toLocationId')];
          const id = new Types.ObjectId();
          const lines = [];
          for (const [i, l] of b.lines.entries()) {
            const item = await loadItem(ctx, l.itemId);
            await assertNotContainerTracked(item, i);
            const batch = await loadBatch(ctx, item._id, l.batchId, { allowExpired: to.type === 'quarantine' });
            const c = costOf(l.quantity, batch.packCost, batch.unitsPerPack);
            await move(ctx, { type: 'transfer', itemId: item._id, batchId: batch._id, quantity: l.quantity, cost: c, from: from._id, to: to._id, sourceType: 'transfer', sourceId: id });
            lines.push({ itemId: item._id, batchId: batch._id, quantity: l.quantity, cost: c });
          }
          const [t] = await StockTransferModel.create(
            [{ _id: id, number: await nextNumber('inventoryTransfer', 'TRF', { year: Number(ctx.date.slice(0, 4)), session }), fromLocationId: from._id, toLocationId: to._id, date: ctx.date, lines, notes: b.notes ?? '', idempotencyKey: key(req) }],
            { session },
          );
          return t!.toObject();
        }),
    );
    await recordAudit({ action: 'create', entity: 'stockTransfer', entityId: doc._id as Types.ObjectId, after: { lines: (doc.lines as unknown[]).length } });
    created(res, { id: String(doc._id), number: doc.number });
  }),
);

/* ---------- adjustments: waste, administrative issue, opening stock ---------- */

inventoryRouter.post(
  '/inventory/adjustments',
  authorize('inventory.stock.adjust'),
  validate({ body: adjustmentBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, adjustmentBody);
    const auth = req.auth!;
    const doc = await once(
      key(req),
      (k) => StockAdjustmentModel.findOne({ idempotencyKey: k }).lean<Record<string, unknown>>(),
      () =>
        withTransaction(async (session) => {
          const ctx = await stockCtx(auth, session);
          const loc = await loadLocation(ctx, b.locationId);
          const id = new Types.ObjectId();
          const lines = [];
          for (const [i, l] of b.lines.entries()) {
            const item = await loadItem(ctx, l.itemId);
            await assertNotContainerTracked(item, i);
            // Expired lots may always be written off.
            const batch = await loadBatch(ctx, item._id, l.batchId, { allowExpired: b.type === 'waste' });
            const c = costOf(l.quantity, batch.packCost, batch.unitsPerPack);
            await move(ctx, { type: b.type, itemId: item._id, batchId: batch._id, quantity: l.quantity, cost: c, from: loc._id, sourceType: 'adjustment', sourceId: id });
            lines.push({ itemId: item._id, batchId: batch._id, quantity: l.quantity, cost: c });
          }
          const total = lines.reduce((s, l) => s + l.cost, 0);
          const number = await nextNumber('inventoryAdjustment', 'ADJ', { year: Number(ctx.date.slice(0, 4)), session });
          const je =
            total > 0
              ? await postInventoryEntry(
                  auth,
                  { date: ctx.date, sourceId: id, memo: `${number} · ${b.reason}`, lines: [{ key: b.type === 'waste' ? 'INVENTORY_WASTE' : 'SUPPLIES_COST', debit: total }, { key: 'INVENTORY', credit: total }] },
                  session,
                )
              : null;
          const [adj] = await StockAdjustmentModel.create([{ _id: id, number, type: b.type, locationId: loc._id, date: ctx.date, reason: b.reason, lines, total, journalEntryId: je?._id, idempotencyKey: key(req) }], { session });
          notifyLowStockAfterCommit(ctx);
          return adj!.toObject();
        }),
    );
    await recordAudit({ action: 'create', entity: 'stockAdjustment', entityId: doc._id as Types.ObjectId, after: { type: doc.type, total: doc.total }, reason: b.reason });
    created(res, { id: String(doc._id), number: doc.number, ...(canSeeCost(auth) ? { total: doc.total } : {}) });
  }),
);

/** Creates the physical containers for `quantity` base units of a container-tracked item. */
export async function createContainers(
  ctx: StockCtx,
  a: { item: { _id: Types.ObjectId; containerCapacity?: number | null; unitsPerPack?: number | null; containerPolicy?: string | null }; batchId: Types.ObjectId; receiptId?: Types.ObjectId; locationId: Types.ObjectId; quantity: number; codePrefix: string; path: string },
) {
  const capacity = a.item.containerCapacity ?? a.item.unitsPerPack ?? 1;
  const count = containerCount(a.quantity, capacity);
  if (count === null || count < 1 || count > 1000) throw ApiError.validation([{ path: a.path, code: 'capacity_must_divide_pack' }]);
  const docs = Array.from({ length: count }, (_, n) => ({
    code: `${a.codePrefix}-${n + 1}`,
    itemId: a.item._id,
    batchId: a.batchId,
    receiptId: a.receiptId,
    locationId: a.locationId,
    initialQuantity: capacity,
    remainingQuantity: capacity,
    status: 'sealed',
    policy: (a.item.containerPolicy ?? 'general') as ContainerPolicy,
  }));
  const made = await InventoryContainerModel.insertMany(docs, { session: ctx.session });
  await ContainerEventModel.insertMany(
    made.map((c) => ({ containerId: c._id, action: 'receive', remainingQuantity: capacity, toLocationId: a.locationId, byUserId: ctx.auth.userId })),
    { session: ctx.session },
  );
  return count;
}

/** Opening stock: new lots at the given unit cost; Dr Inventory / Cr Opening balance (08b §4). */
export async function postOpeningStock(auth: AuthContext, b: z.infer<typeof openingStockBody>, idempotencyKey?: string) {
  return once(
    idempotencyKey,
    (k) => StockAdjustmentModel.findOne({ idempotencyKey: k }).lean<Record<string, unknown>>(),
    () =>
      withTransaction(async (session) => {
        const ctx = await stockCtx(auth, session);
        if (b.date) ctx.date = b.date;
        const loc = await loadLocation(ctx, b.locationId);
        const id = new Types.ObjectId();
        const number = await nextNumber('inventoryAdjustment', 'ADJ', { year: Number(ctx.date.slice(0, 4)), session });
        const lines = [];
        for (const [i, l] of b.lines.entries()) {
          const item = await loadItem(ctx, l.itemId);
          const [batch] = await InventoryBatchModel.create([{ itemId: item._id, lotNumber: l.lotNumber ?? '', expiresAt: l.expiresAt, packCost: l.unitCost, unitsPerPack: 1, source: 'opening' }], { session });
          const c = costOf(l.quantity, l.unitCost, 1);
          await move(ctx, { type: 'opening', itemId: item._id, batchId: batch!._id, quantity: l.quantity, cost: c, to: loc._id, sourceType: 'adjustment', sourceId: id });
          if (item.trackContainers) await createContainers(ctx, { item, batchId: batch!._id, locationId: loc._id, quantity: l.quantity, codePrefix: `${number}-${i + 1}`, path: `lines.${i}.quantity` });
          lines.push({ itemId: item._id, batchId: batch!._id, quantity: l.quantity, cost: c });
        }
        const total = lines.reduce((sum, l) => sum + l.cost, 0);
        const je = total > 0 ? await postInventoryEntry(auth, { date: ctx.date, sourceId: id, memo: `${number} · opening stock`, lines: [{ key: 'INVENTORY', debit: total }, { key: 'OPENING_BALANCE', credit: total }] }, session) : null;
        const [adj] = await StockAdjustmentModel.create([{ _id: id, number, type: 'opening', locationId: loc._id, date: ctx.date, reason: 'opening', lines, total, journalEntryId: je?._id, idempotencyKey }], { session });
        return adj!.toObject();
      }),
  );
}

inventoryRouter.post(
  '/inventory/opening-stock',
  authorize('inventory.stock.adjust'),
  validate({ body: openingStockBody }),
  asyncHandler(async (req, res) => {
    const doc = await postOpeningStock(req.auth!, body(req, openingStockBody), key(req));
    await recordAudit({ action: 'create', entity: 'stockAdjustment', entityId: doc._id as Types.ObjectId, after: { type: 'opening', total: doc.total } });
    created(res, { id: String(doc._id), number: doc.number });
  }),
);

const docsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();
for (const [path, model] of [
  ['/inventory/transfers', StockTransferModel],
  ['/inventory/adjustments', StockAdjustmentModel],
] as const) {
  inventoryRouter.get(
    path,
    authorize('inventory.item.read'),
    validate({ query: docsQuery }),
    asyncHandler(async (req, res) => {
      const q = query(req, docsQuery);
      const rows = await (model as typeof StockAdjustmentModel).find({}).sort({ createdAt: -1 }).limit(q.limit).lean();
      const cost = canSeeCost(req.auth!);
      ok(
        res,
        rows.map((r) => {
          const { idempotencyKey: _k, journalEntryId, ...rest } = defaultDto(r as never) as Record<string, unknown>;
          const dto: Record<string, unknown> = { ...rest, journalEntryId: idOf(journalEntryId) };
          if (!cost) {
            delete dto.total;
            dto.lines = ((dto.lines as Record<string, unknown>[]) ?? []).map(({ cost: _c, ...l }) => l);
          }
          return dto;
        }),
      );
    }),
  );
}

/* ---------- containers ---------- */

const containersQuery = z
  .object({
    status: optional(z.string().max(40)),
    locationId: optional(objectId()),
    itemId: optional(objectId()),
    limit: z.coerce.number().int().min(1).max(500).default(300),
  })
  .strict();

async function containerDtos(rows: Record<string, unknown>[], today: string) {
  const [items, batches, locations] = await Promise.all([
    InventoryItemModel.find({ _id: { $in: rows.map((r) => r.itemId) } }).select('name unit').lean(),
    InventoryBatchModel.find({ _id: { $in: rows.map((r) => r.batchId) } }).select('lotNumber expiresAt').lean(),
    InventoryLocationModel.find({ _id: { $in: rows.map((r) => r.locationId) } }).select('name type').lean(),
  ]);
  const item = new Map(items.map((i) => [String(i._id), i]));
  const batch = new Map(batches.map((b) => [String(b._id), b]));
  const loc = new Map(locations.map((l) => [String(l._id), l]));
  return rows.map((r) => {
    const b = batch.get(String(r.batchId));
    const bud = r.beyondUseDate as string | undefined;
    return {
      id: String(r._id),
      code: r.code,
      itemId: String(r.itemId),
      itemName: item.get(String(r.itemId))?.name ?? '',
      unit: item.get(String(r.itemId))?.unit ?? '',
      batchId: String(r.batchId),
      lotNumber: b?.lotNumber ?? '',
      expiresAt: b?.expiresAt,
      locationId: String(r.locationId),
      locationName: loc.get(String(r.locationId))?.name ?? '',
      locationType: loc.get(String(r.locationId))?.type,
      initialQuantity: r.initialQuantity,
      remainingQuantity: r.remainingQuantity,
      status: r.status,
      policy: r.policy,
      openedAt: r.openedAt,
      beyondUseDate: bud,
      usable: r.status === 'open' && (!bud || bud >= today) && (!b?.expiresAt || b.expiresAt >= today),
    };
  });
}

inventoryRouter.get(
  '/inventory/containers',
  authorize(...STOCK_READ),
  validate({ query: containersQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, containersQuery);
    const statuses = q.status ? q.status.split(',') : ['sealed', 'open'];
    const rows = await InventoryContainerModel.find({ status: { $in: statuses }, ...(q.locationId ? { locationId: q.locationId } : {}), ...(q.itemId ? { itemId: q.itemId } : {}) })
      .sort({ status: -1, createdAt: 1 })
      .limit(q.limit)
      .lean();
    ok(res, await containerDtos(rows as never, await clinicToday()));
  }),
);

inventoryRouter.get(
  '/inventory/containers/:id/events',
  authorize(...STOCK_READ),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = params(req, idParams);
    if (!(await InventoryContainerModel.exists({ _id: id }))) throw ApiError.notFound();
    const rows = await ContainerEventModel.find({ containerId: id }).sort({ at: -1 }).limit(200).lean();
    const cost = canSeeCost(req.auth!);
    ok(
      res,
      rows.map((e) => ({
        id: String(e._id),
        action: e.action,
        at: e.at,
        usedQuantity: e.usedQuantity,
        wastedQuantity: e.wastedQuantity,
        autoWasteQuantity: e.autoWasteQuantity,
        remainingQuantity: e.remainingQuantity,
        beyondUseDate: e.beyondUseDate,
        reason: e.reason,
        patientId: idOf(e.patientId),
        performedProcedureId: idOf(e.performedProcedureId),
        ...(cost ? { cost: e.cost } : {}),
      })),
    );
  }),
);

/** Opening has no stock or accounting effect; it starts the container's in-use life (08b §6). */
inventoryRouter.post(
  '/inventory/containers/:id/open',
  authorize('inventory.stock.adjust', 'inventory.usage.record'),
  validate({ params: idParams, body: containerOpenBody }),
  asyncHandler(async (req, res) => {
    const { id } = params(req, idParams);
    const b = body(req, containerOpenBody);
    const auth = req.auth!;
    const result = await withTransaction(async (session) => {
      const ctx = await stockCtx(auth, session);
      const c = await InventoryContainerModel.findById(id).session(sess(ctx));
      if (!c) throw ApiError.notFound();
      if (c.status !== 'sealed') throw ApiError.conflict('CONTAINER_NOT_SEALED', 'Only sealed containers can be opened');
      const batch = await loadBatch(ctx, c.itemId, c.batchId);
      const loc = await InventoryLocationModel.findById(c.locationId).session(sess(ctx)).lean();
      if (c.policy === 'multi_dose') {
        if (loc?.type !== 'medication_prep') throw ApiError.conflict('CONTAINER_POLICY_VIOLATION', 'Multi-dose containers are opened in a clean medication preparation area', { rule: 'multi_dose_prep_area' });
        if (!b.beyondUseDate) throw ApiError.validation([{ path: 'beyondUseDate', code: 'required' }]);
      }
      if (b.beyondUseDate) {
        if (b.beyondUseDate < ctx.date) throw ApiError.validation([{ path: 'beyondUseDate', code: 'date_in_past' }]);
        if (batch.expiresAt && b.beyondUseDate > batch.expiresAt) throw ApiError.validation([{ path: 'beyondUseDate', code: 'beyond_use_after_expiry' }]);
      }
      c.status = 'open';
      c.openedAt = new Date();
      c.openedBy = new Types.ObjectId(auth.userId);
      if (b.beyondUseDate) c.beyondUseDate = b.beyondUseDate;
      await c.save({ session });
      await ContainerEventModel.create([{ containerId: c._id, action: 'open', remainingQuantity: c.remainingQuantity, beyondUseDate: b.beyondUseDate, byUserId: auth.userId }], { session });
      return c.toObject();
    });
    await recordAudit({ action: 'status_change', entity: 'inventoryContainer', entityId: result._id, after: { status: 'open', beyondUseDate: result.beyondUseDate } });
    ok(res, (await containerDtos([result as never], await clinicToday()))[0]);
  }),
);

inventoryRouter.post(
  '/inventory/containers/:id/transfer',
  authorize('inventory.stock.adjust'),
  validate({ params: idParams, body: containerTransferBody }),
  asyncHandler(async (req, res) => {
    const { id } = params(req, idParams);
    const b = body(req, containerTransferBody);
    const auth = req.auth!;
    const result = await withTransaction(async (session) => {
      const ctx = await stockCtx(auth, session);
      const c = await InventoryContainerModel.findById(id).session(sess(ctx));
      if (!c) throw ApiError.notFound();
      if (!['sealed', 'open'].includes(c.status as string)) throw ApiError.conflict('CONTAINER_CLOSED', 'This container is empty or discarded');
      const target = await loadLocation(ctx, b.toLocationId, 'toLocationId');
      if (String(target._id) === String(c.locationId)) throw ApiError.validation([{ path: 'toLocationId', code: 'same_location' }]);
      if (c.policy === 'multi_dose' && !['medication_prep', 'quarantine'].includes(target.type as string)) throw ApiError.conflict('CONTAINER_POLICY_VIOLATION', 'Multi-dose containers stay in a medication preparation area', { rule: 'multi_dose_prep_area' });
      if (c.policy === 'single_use' && c.status === 'open') throw ApiError.conflict('CONTAINER_POLICY_VIOLATION', 'An opened single-use container is used or discarded, not moved', { rule: 'single_use_open' });
      const batch = await loadBatch(ctx, c.itemId, c.batchId, { allowExpired: true });
      const from = c.locationId;
      const cost = costOf(c.remainingQuantity, batch.packCost, batch.unitsPerPack);
      await move(ctx, { type: 'container_transfer', itemId: c.itemId, batchId: c.batchId, containerId: c._id, quantity: c.remainingQuantity, cost, from, to: target._id, sourceType: 'container', sourceId: c._id });
      c.locationId = target._id;
      await c.save({ session });
      await ContainerEventModel.create([{ containerId: c._id, action: 'transfer', fromLocationId: from, toLocationId: target._id, remainingQuantity: c.remainingQuantity, byUserId: auth.userId }], { session });
      return c.toObject();
    });
    await recordAudit({ action: 'update', entity: 'inventoryContainer', entityId: result._id, after: { locationId: String(result.locationId) } });
    ok(res, (await containerDtos([result as never], await clinicToday()))[0]);
  }),
);

inventoryRouter.post(
  '/inventory/containers/:id/discard',
  authorize('inventory.stock.adjust', 'inventory.usage.record'),
  validate({ params: idParams, body: containerDiscardBody }),
  asyncHandler(async (req, res) => {
    const { id } = params(req, idParams);
    const b = body(req, containerDiscardBody);
    const auth = req.auth!;
    const result = await withTransaction(async (session) => {
      const ctx = await stockCtx(auth, session);
      const c = await InventoryContainerModel.findById(id).session(sess(ctx));
      if (!c) throw ApiError.notFound();
      if (!['sealed', 'open'].includes(c.status as string) || c.remainingQuantity <= 0) throw ApiError.conflict('CONTAINER_CLOSED', 'This container is already empty or discarded');
      const batch = await loadBatch(ctx, c.itemId, c.batchId, { allowExpired: true });
      const qty = c.remainingQuantity;
      const cost = costOf(qty, batch.packCost, batch.unitsPerPack);
      await move(ctx, { type: 'container_discard', itemId: c.itemId, batchId: c.batchId, containerId: c._id, quantity: qty, cost, from: c.locationId, sourceType: 'container', sourceId: c._id });
      c.status = 'discarded';
      c.remainingQuantity = 0;
      c.closedAt = new Date();
      await c.save({ session });
      await ContainerEventModel.create([{ containerId: c._id, action: 'discard', wastedQuantity: qty, remainingQuantity: 0, reason: b.reason, cost, byUserId: auth.userId }], { session });
      if (cost > 0) await postInventoryEntry(auth, { date: ctx.date, sourceId: c._id, memo: `${c.code} · ${b.reason}`, lines: [{ key: 'INVENTORY_WASTE', debit: cost }, { key: 'INVENTORY', credit: cost }] }, session);
      notifyLowStockAfterCommit(ctx);
      return c.toObject();
    });
    await recordAudit({ action: 'status_change', entity: 'inventoryContainer', entityId: result._id, after: { status: 'discarded' }, reason: b.reason });
    ok(res, (await containerDtos([result as never], await clinicToday()))[0]);
  }),
);

/* ---------- procedure material templates ---------- */

const procParams = z.object({ clinicProcedureId: objectId() });

inventoryRouter.get(
  '/procedure-materials',
  authorize(...STOCK_READ),
  asyncHandler(async (_req, res) => {
    const rows = await ProcedureMaterialModel.find({ 'materials.0': { $exists: true } }).lean();
    ok(
      res,
      rows.map((r) => ({
        clinicProcedureId: String(r.clinicProcedureId),
        materials: r.materials.map((m) => ({ itemId: String(m.itemId), defaultQuantity: m.defaultQuantity, usageScope: m.usageScope, optional: Boolean(m.optional) })),
      })),
    );
  }),
);

inventoryRouter.put(
  '/procedure-materials/:clinicProcedureId',
  authorize('inventory.item.manage'),
  validate({ params: procParams, body: procedureMaterialsBody }),
  asyncHandler(async (req, res) => {
    const { clinicProcedureId } = params(req, procParams);
    const b = body(req, procedureMaterialsBody);
    if (!(await ClinicProcedureModel.exists({ _id: clinicProcedureId }))) throw ApiError.notFound();
    const items = await InventoryItemModel.find({ _id: { $in: b.materials.map((m) => m.itemId) } }).select('type').lean();
    const typeOf = new Map(items.map((i) => [String(i._id), i.type]));
    b.materials.forEach((m, i) => {
      const type = typeOf.get(m.itemId);
      if (!type) throw ApiError.validation([{ path: `materials.${i}.itemId`, code: 'not_found' }]);
      if (type === 'reusable' || type === 'equipment') throw ApiError.validation([{ path: `materials.${i}.itemId`, code: 'invalid_option' }]);
    });
    const doc = await ProcedureMaterialModel.findOneAndUpdate({ clinicProcedureId }, { $set: { materials: b.materials } }, { upsert: true, new: true }).lean();
    await recordAudit({ action: 'update', entity: 'procedureMaterials', entityId: doc!._id, after: { materials: b.materials.length } });
    ok(res, { clinicProcedureId, materials: b.materials });
  }),
);

registerPath({ method: 'get', path: '/inventory/overview', tags: ['inventory'], summary: 'Low stock, expiring lots, containers near beyond-use, value' });
registerPath({ method: 'get', path: '/inventory/balances', tags: ['inventory'], summary: 'Stock per location and lot (FEFO order)', query: balancesQuery });
registerPath({ method: 'get', path: '/inventory/movements', tags: ['inventory'], summary: 'Stock movement ledger', query: movementsQuery });
registerPath({ method: 'post', path: '/inventory/transfers', tags: ['inventory'], summary: 'Move stock between locations (no accounting effect)', body: transferBody });
registerPath({ method: 'post', path: '/inventory/adjustments', tags: ['inventory'], summary: 'Waste or administrative issue (Dr expense / Cr inventory)', body: adjustmentBody });
registerPath({ method: 'post', path: '/inventory/opening-stock', tags: ['inventory'], summary: 'Opening stock (Dr inventory / Cr opening balance)', body: openingStockBody });
registerPath({ method: 'get', path: '/inventory/containers', tags: ['inventory'], summary: 'Physical containers (sealed and open by default)', query: containersQuery });
registerPath({ method: 'post', path: '/inventory/containers/:id/open', tags: ['inventory'], summary: 'Open a sealed container', params: idParams, body: containerOpenBody });
registerPath({ method: 'post', path: '/inventory/containers/:id/transfer', tags: ['inventory'], summary: 'Move a whole container', params: idParams, body: containerTransferBody });
registerPath({ method: 'post', path: '/inventory/containers/:id/discard', tags: ['inventory'], summary: 'Discard what is left (Dr waste / Cr inventory)', params: idParams, body: containerDiscardBody });
registerPath({ method: 'put', path: '/procedure-materials/:clinicProcedureId', tags: ['inventory'], summary: 'Default materials of a procedure', params: procParams, body: procedureMaterialsBody });
