import type { ClientSession, Types } from 'mongoose';
import type { AuthContext } from '@/core/auth/auth.types';
import { onCommit } from '@/core/db/transaction';
import { ApiError } from '@/core/http/ApiError';
import { fieldPolicyOf } from '@/core/rbac/authorize';
import { currentClinicId } from '@/core/tenancy/tenantPlugin';
import { roundQty, type MovementType } from '@/shared/inventory';
import { InventoryBatchModel, InventoryItemModel, InventoryLocationModel, StockBalanceModel, StockMovementModel } from './inventory.models';

type Id = Types.ObjectId | string;
export type StockCtx = { auth: AuthContext; session?: ClientSession; date: string; lowStock: Set<string> };

export const sess = (ctx: { session?: ClientSession }) => ctx.session ?? null;

/** Cost and value fields follow the `inventory.item` field policy (04 §4): hidden unless granted. */
export function canSeeCost(auth: AuthContext): boolean {
  return fieldPolicyOf(auth, 'inventory.item', 'inventory.item.read').visible.has('cost');
}

export async function loadItem(ctx: StockCtx, id: Id) {
  const item = await InventoryItemModel.findById(id).session(sess(ctx));
  if (!item) throw ApiError.validation([{ path: 'itemId', code: 'not_found' }]);
  return item;
}

export async function loadLocation(ctx: StockCtx, id: Id, path = 'locationId') {
  const loc = await InventoryLocationModel.findById(id).session(sess(ctx)).lean();
  if (!loc) throw ApiError.validation([{ path, code: 'not_found' }]);
  if (!loc.isActive) throw ApiError.validation([{ path, code: 'inactive' }]);
  return loc;
}

/** The lot, which must belong to the item and must not be past its labelled expiry. */
export async function loadBatch(ctx: StockCtx, itemId: Id, batchId: Id, { allowExpired = false } = {}) {
  const batch = await InventoryBatchModel.findOne({ _id: batchId, itemId }).session(sess(ctx)).lean();
  if (!batch) throw ApiError.validation([{ path: 'batchId', code: 'not_found' }]);
  if (!allowExpired && batch.expiresAt && batch.expiresAt < ctx.date) throw ApiError.conflict('BATCH_EXPIRED', 'This lot has expired', { lotNumber: batch.lotNumber, expiresAt: batch.expiresAt });
  return batch;
}

/** Changes one balance row; never below zero (409 INSUFFICIENT_STOCK). */
async function changeBalance(ctx: StockCtx, key: { locationId: Id; itemId: Id; batchId: Id }, delta: number) {
  const row = await StockBalanceModel.findOne(key).session(sess(ctx));
  const current = row?.quantity ?? 0;
  const next = roundQty(current + delta);
  if (next < 0) throw ApiError.conflict('INSUFFICIENT_STOCK', 'Not enough stock at this location and lot', { available: current });
  if (row) {
    const res = await StockBalanceModel.updateOne({ _id: row._id, quantity: current }, { $set: { quantity: next } }, { session: ctx.session });
    if (res.matchedCount !== 1) throw ApiError.conflict('VERSION_CONFLICT', 'Stock changed meanwhile, try again');
  } else {
    await StockBalanceModel.create([{ ...key, quantity: next }], { session: ctx.session });
  }
}

async function changeOnHand(ctx: StockCtx, itemId: Id, delta: number) {
  const item = await InventoryItemModel.findById(itemId).select('quantityOnHand reorderLevel').session(sess(ctx)).lean();
  if (!item) throw ApiError.notFound();
  const before = item.quantityOnHand ?? 0;
  const after = roundQty(before + delta);
  await InventoryItemModel.updateOne({ _id: itemId }, { $set: { quantityOnHand: after } }, { session: ctx.session });
  // Alert once, when stock crosses the reorder level downwards.
  if (delta < 0 && (item.reorderLevel ?? 0) > 0 && after <= (item.reorderLevel ?? 0) && before > (item.reorderLevel ?? 0)) ctx.lowStock.add(String(itemId));
}

export type MoveInput = {
  type: MovementType;
  itemId: Id;
  batchId: Id;
  quantity: number;
  cost: number;
  from?: Id | null;
  to?: Id | null;
  sourceType: string;
  sourceId: Types.ObjectId;
  containerId?: Id | null;
  patientId?: Id | null;
};

/** One ledger movement: balances at both ends, the item total and an immutable movement row. */
export async function move(ctx: StockCtx, m: MoveInput) {
  const qty = roundQty(m.quantity);
  if (m.from) await changeBalance(ctx, { locationId: m.from, itemId: m.itemId, batchId: m.batchId }, -qty);
  if (m.to) await changeBalance(ctx, { locationId: m.to, itemId: m.itemId, batchId: m.batchId }, qty);
  if (Boolean(m.from) !== Boolean(m.to)) await changeOnHand(ctx, m.itemId, m.to ? qty : -qty);
  await StockMovementModel.create(
    [
      {
        type: m.type,
        itemId: m.itemId,
        batchId: m.batchId,
        containerId: m.containerId ?? undefined,
        quantity: qty,
        cost: m.cost,
        fromLocationId: m.from ?? undefined,
        toLocationId: m.to ?? undefined,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        patientId: m.patientId ?? undefined,
        date: ctx.date,
        byUserId: ctx.auth.userId,
      },
    ],
    { session: ctx.session },
  );
}

/** Notifies owners/managers/front desk after commit for items that crossed their reorder level. */
export function notifyLowStockAfterCommit(ctx: StockCtx) {
  if (!ctx.lowStock.size) return;
  const ids = [...ctx.lowStock];
  const clinicId = String(currentClinicId());
  onCommit(ctx.session, async () => {
    const { notify, usersOf } = await import('@/modules/notifications/notifications');
    const items = await InventoryItemModel.find({ _id: { $in: ids } }).select('name quantityOnHand unit').lean();
    const users = await usersOf(clinicId, { owners: true, staffTypes: ['manager', 'receptionist'] });
    for (const it of items) {
      await notify(clinicId, users, { type: 'low_stock', titleKey: 'notifications:types.low_stock', bodyKey: 'notifications:msg.lowStock', params: { item: it.name, qty: it.quantityOnHand ?? 0 }, link: '/clinic/inventory/items' });
    }
  });
}

/**
 * Makes a posting safe to retry: the same `Idempotency-Key` returns the document it created
 * instead of posting twice (09 §3.2).
 */
export async function once<T>(key: string | undefined, find: (key: string) => PromiseLike<T | null>, run: () => Promise<T>): Promise<T> {
  if (key) {
    const found = await find(key);
    if (found) return found;
  }
  try {
    return await run();
  } catch (err) {
    if (key && (err as { code?: number }).code === 11000) {
      const won = await find(key);
      if (won) return won;
    }
    throw err;
  }
}
