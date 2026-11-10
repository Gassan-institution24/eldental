import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import { nextNumber } from '@/core/db/sequence';
import { withTransaction } from '@/core/db/transaction';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { body, params, query, validate } from '@/core/validation/validate';
import { SupplierBillModel, SupplierModel } from '@/modules/accounting/accounting.models';
import { clinicToday } from '@/modules/accounting/journal.service';
import * as ops from '@/modules/accounting/operations.service';
import { mul, sum } from '@/shared/money';
import { billFromReceiptBody, costOf, PO_STATUSES, purchaseOrderBody, receiptBody, roundQty } from '@/shared/inventory';
import { enumOf, objectId, optional, requiredText } from '@/shared/validation/fields';
import { grniAccountId, postInventoryEntry } from './inventory.accounts';
import { GoodsReceiptModel, InventoryBatchModel, InventoryItemModel, InventoryLocationModel, PurchaseOrderModel } from './inventory.models';
import { createContainers, stockCtx } from './inventory.routes';
import { loadItem, loadLocation, move, once, sess } from './stock.service';

/**
 * Purchasing (08b §3): purchase order (no stock, no accounting) → goods receipt
 * (stock up; Dr Inventory / Cr GRNI) → supplier bill (Dr GRNI / Cr AP, via accounting) → payment
 * (Accounting → Supplier payments).
 */
export const purchasingRouter = Router();

const idParams = z.object({ id: objectId() });
const PO_READ = ['inventory.purchase.read', 'inventory.purchase.manage', 'inventory.purchase.receive'] as const;
const key = (req: { header: (h: string) => string | undefined }) => req.header('idempotency-key')?.slice(0, 100) || undefined;

type Line = { _id: Types.ObjectId; itemId: Types.ObjectId; packs: number; unitsPerPack: number; packPrice: number; lineTotal: number; receivedQuantity: number };

async function poDtos(rows: Record<string, unknown>[]) {
  const lines = rows.flatMap((r) => r.lines as Line[]);
  const [suppliers, items] = await Promise.all([
    SupplierModel.find({ _id: { $in: rows.map((r) => r.supplierId) } }).select('name').lean(),
    InventoryItemModel.find({ _id: { $in: lines.map((l) => l.itemId) } }).select('name unit purchaseUnit trackContainers').lean(),
  ]);
  const sup = new Map(suppliers.map((s) => [String(s._id), s.name]));
  const item = new Map(items.map((i) => [String(i._id), i]));
  return rows.map((r) => ({
    id: String(r._id),
    version: (r.__v as number) ?? 0,
    number: r.number,
    supplierId: String(r.supplierId),
    supplierName: sup.get(String(r.supplierId)) ?? '',
    date: r.date,
    expectedDate: r.expectedDate,
    status: r.status,
    total: r.total,
    notes: r.notes,
    cancelReason: r.cancelReason,
    lines: (r.lines as Line[]).map((l) => {
      const it = item.get(String(l.itemId));
      const ordered = roundQty(l.packs * l.unitsPerPack);
      return {
        id: String(l._id),
        itemId: String(l.itemId),
        itemName: it?.name ?? '',
        unit: it?.unit ?? '',
        purchaseUnit: it?.purchaseUnit ?? '',
        trackContainers: Boolean(it?.trackContainers),
        packs: l.packs,
        unitsPerPack: l.unitsPerPack,
        packPrice: l.packPrice,
        lineTotal: l.lineTotal,
        orderedQuantity: ordered,
        receivedQuantity: l.receivedQuantity ?? 0,
        remainingQuantity: roundQty(ordered - (l.receivedQuantity ?? 0)),
      };
    }),
  }));
}

/* ---------- purchase orders ---------- */

const poQuery = z.object({ status: optional(enumOf([...PO_STATUSES, 'receivable'])), supplierId: optional(objectId()), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();

purchasingRouter.get(
  '/purchase-orders',
  authorize(...PO_READ),
  validate({ query: poQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, poQuery);
    const status = q.status === 'receivable' ? { status: { $in: ['open', 'partially_received'] } } : q.status ? { status: q.status } : {};
    const rows = await PurchaseOrderModel.find({ ...status, ...(q.supplierId ? { supplierId: q.supplierId } : {}) }).sort({ createdAt: -1 }).limit(q.limit).lean();
    ok(res, await poDtos(rows as never));
  }),
);

purchasingRouter.get(
  '/purchase-orders/:id',
  authorize(...PO_READ),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const po = await PurchaseOrderModel.findById(params(req, idParams).id).lean();
    if (!po) throw ApiError.notFound();
    ok(res, (await poDtos([po as never]))[0]);
  }),
);

purchasingRouter.post(
  '/purchase-orders',
  authorize('inventory.purchase.manage'),
  validate({ body: purchaseOrderBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, purchaseOrderBody);
    const supplier = await SupplierModel.findById(b.supplierId).select('isActive').lean();
    if (!supplier) throw ApiError.validation([{ path: 'supplierId', code: 'not_found' }]);
    if (supplier.isActive === false) throw ApiError.validation([{ path: 'supplierId', code: 'inactive' }]);
    const items = await InventoryItemModel.find({ _id: { $in: b.lines.map((l) => l.itemId) } }).select('unitsPerPack isActive').lean();
    const byId = new Map(items.map((i) => [String(i._id), i]));
    const lines = b.lines.map((l, i) => {
      const it = byId.get(l.itemId);
      if (!it) throw ApiError.validation([{ path: `lines.${i}.itemId`, code: 'not_found' }]);
      if (!it.isActive) throw ApiError.validation([{ path: `lines.${i}.itemId`, code: 'inactive' }]);
      return { itemId: l.itemId, packs: l.packs, unitsPerPack: it.unitsPerPack ?? 1, packPrice: l.packPrice, lineTotal: mul(l.packPrice, l.packs), receivedQuantity: 0 };
    });
    const date = b.date ?? (await clinicToday());
    const po = await PurchaseOrderModel.create({
      number: await nextNumber('purchaseOrder', 'PO', { year: Number(date.slice(0, 4)) }),
      supplierId: b.supplierId,
      date,
      expectedDate: b.expectedDate,
      notes: b.notes ?? '',
      lines,
      total: sum(lines.map((l) => l.lineTotal)),
      status: 'open',
    });
    await recordAudit({ action: 'create', entity: 'purchaseOrder', entityId: po._id, after: { total: po.total } });
    created(res, (await poDtos([po.toObject() as never]))[0]);
  }),
);

const cancelBody = z.object({ reason: requiredText(300) }).strict();
purchasingRouter.post(
  '/purchase-orders/:id/cancel',
  authorize('inventory.purchase.manage'),
  validate({ params: idParams, body: cancelBody }),
  asyncHandler(async (req, res) => {
    const { id } = params(req, idParams);
    const { reason } = body(req, cancelBody);
    // Only before anything was received; afterwards the receipts are the record.
    const po = await PurchaseOrderModel.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { status: 'cancelled', cancelReason: reason } }, { new: true }).lean();
    if (!po) {
      if (!(await PurchaseOrderModel.exists({ _id: id }))) throw ApiError.notFound();
      throw ApiError.conflict('PO_NOT_OPEN', 'Only orders with nothing received can be cancelled');
    }
    await recordAudit({ action: 'status_change', entity: 'purchaseOrder', entityId: po._id, after: { status: 'cancelled' }, reason });
    ok(res, (await poDtos([po as never]))[0]);
  }),
);

/* ---------- goods receipts ---------- */

async function receiptDtos(rows: Record<string, unknown>[]) {
  const lines = rows.flatMap((r) => r.lines as { itemId: Types.ObjectId }[]);
  const [suppliers, items, locations, pos, bills] = await Promise.all([
    SupplierModel.find({ _id: { $in: rows.map((r) => r.supplierId) } }).select('name').lean(),
    InventoryItemModel.find({ _id: { $in: lines.map((l) => l.itemId) } }).select('name unit').lean(),
    InventoryLocationModel.find({ _id: { $in: rows.map((r) => r.locationId) } }).select('name').lean(),
    PurchaseOrderModel.find({ _id: { $in: rows.map((r) => r.poId) } }).select('number').lean(),
    SupplierBillModel.find({ _id: { $in: rows.map((r) => r.billId).filter(Boolean) } }).select('number supplierRef status').lean(),
  ]);
  const name = new Map([...suppliers, ...items, ...locations].map((d) => [String(d._id), d.name]));
  const unit = new Map(items.map((i) => [String(i._id), i.unit]));
  const poNo = new Map(pos.map((p) => [String(p._id), p.number]));
  const bill = new Map(bills.map((b) => [String(b._id), b]));
  return rows.map((r) => {
    const bl = r.billId ? bill.get(String(r.billId)) : undefined;
    return {
      id: String(r._id),
      number: r.number,
      poId: String(r.poId),
      poNumber: poNo.get(String(r.poId)) ?? '',
      supplierId: String(r.supplierId),
      supplierName: name.get(String(r.supplierId)) ?? '',
      locationId: String(r.locationId),
      locationName: name.get(String(r.locationId)) ?? '',
      date: r.date,
      total: r.total,
      notes: r.notes,
      journalEntryId: r.journalEntryId ? String(r.journalEntryId) : undefined,
      bill: bl ? { id: String(bl._id), number: bl.number, supplierRef: bl.supplierRef, status: bl.status } : undefined,
      lines: (r.lines as Record<string, unknown>[]).map((l) => ({
        itemId: String(l.itemId),
        itemName: name.get(String(l.itemId)) ?? '',
        unit: unit.get(String(l.itemId)) ?? '',
        batchId: String(l.batchId),
        lotNumber: l.lotNumber,
        expiresAt: l.expiresAt,
        quantity: l.quantity,
        cost: l.cost,
        containers: l.containers ?? 0,
      })),
    };
  });
}

const receiptQuery = z.object({ poId: optional(objectId()), unbilled: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();

purchasingRouter.get(
  '/goods-receipts',
  authorize(...PO_READ, 'accounting.supplier.manage'),
  validate({ query: receiptQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, receiptQuery);
    const rows = await GoodsReceiptModel.find({ ...(q.poId ? { poId: q.poId } : {}), ...(q.unbilled === 'true' ? { billId: null } : {}) })
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .lean();
    ok(res, await receiptDtos(rows as never));
  }),
);

purchasingRouter.post(
  '/goods-receipts',
  authorize('inventory.purchase.receive'),
  validate({ body: receiptBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, receiptBody);
    const auth = req.auth!;
    const doc = await once(
      key(req),
      (k) => GoodsReceiptModel.findOne({ idempotencyKey: k }).lean<Record<string, unknown>>(),
      () =>
        withTransaction(async (session) => {
          const ctx = await stockCtx(auth, session);
          if (b.date) ctx.date = b.date;
          const po = await PurchaseOrderModel.findById(b.poId).session(sess(ctx));
          if (!po) throw ApiError.validation([{ path: 'poId', code: 'not_found' }]);
          if (!['open', 'partially_received'].includes(po.status as string)) throw ApiError.conflict('PO_NOT_OPEN', 'This order is received in full or cancelled');
          const loc = await loadLocation(ctx, b.locationId);
          const id = new Types.ObjectId();
          const number = await nextNumber('goodsReceipt', 'GRN', { year: Number(ctx.date.slice(0, 4)), session });
          const lines = [];
          for (const [i, l] of b.lines.entries()) {
            const pl = po.lines.find((x) => String(x._id) === l.poLineId);
            if (!pl) throw ApiError.validation([{ path: `lines.${i}.poLineId`, code: 'not_found' }]);
            const remaining = roundQty(pl.packs * pl.unitsPerPack - (pl.receivedQuantity ?? 0));
            if (l.quantity > remaining) throw ApiError.conflict('OVER_RECEIPT', 'More than what is still to be received', { line: i, remaining });
            if (l.expiresAt && l.expiresAt < ctx.date) throw ApiError.validation([{ path: `lines.${i}.expiresAt`, code: 'expired_lot' }]);
            const item = await loadItem(ctx, pl.itemId);
            const [batch] = await InventoryBatchModel.create(
              [{ itemId: item._id, lotNumber: l.lotNumber, expiresAt: l.expiresAt, packCost: pl.packPrice, unitsPerPack: pl.unitsPerPack, receiptId: id, supplierId: po.supplierId, source: 'receipt' }],
              { session },
            );
            const cost = costOf(l.quantity, pl.packPrice, pl.unitsPerPack);
            await move(ctx, { type: 'purchase_receipt', itemId: item._id, batchId: batch!._id, quantity: l.quantity, cost, to: loc._id, sourceType: 'receipt', sourceId: id });
            const containers = item.trackContainers ? await createContainers(ctx, { item, batchId: batch!._id, receiptId: id, locationId: loc._id, quantity: l.quantity, codePrefix: `${number}-${i + 1}`, path: `lines.${i}.quantity` }) : 0;
            pl.receivedQuantity = roundQty((pl.receivedQuantity ?? 0) + l.quantity);
            lines.push({ poLineId: pl._id, itemId: item._id, batchId: batch!._id, quantity: l.quantity, packCost: pl.packPrice, unitsPerPack: pl.unitsPerPack, cost, lotNumber: l.lotNumber, expiresAt: l.expiresAt, containers });
          }
          po.status = po.lines.every((x) => (x.receivedQuantity ?? 0) >= roundQty(x.packs * x.unitsPerPack)) ? 'received' : 'partially_received';
          await po.save({ session });
          const total = sum(lines.map((l) => l.cost));
          const je = total > 0 ? await postInventoryEntry(auth, { date: ctx.date, sourceId: id, memo: `${number} · ${po.number}`, lines: [{ key: 'INVENTORY', debit: total }, { key: 'GRNI', credit: total, supplierId: String(po.supplierId) }] }, session) : null;
          const [receipt] = await GoodsReceiptModel.create(
            [{ _id: id, number, poId: po._id, supplierId: po.supplierId, locationId: loc._id, date: ctx.date, lines, total, notes: b.notes ?? '', journalEntryId: je?._id, idempotencyKey: key(req) }],
            { session },
          );
          return receipt!.toObject();
        }),
    );
    await recordAudit({ action: 'create', entity: 'goodsReceipt', entityId: doc._id as Types.ObjectId, after: { total: doc.total } });
    created(res, (await receiptDtos([doc as never]))[0]);
  }),
);

/**
 * The supplier's invoice for a receipt: a posted supplier bill whose line clears GRNI
 * (Dr GRNI / Cr AP). It never adds stock. Payment is made in Accounting → Supplier payments.
 */
purchasingRouter.post(
  '/goods-receipts/:id/bill',
  authorize('accounting.supplier.manage'),
  validate({ params: idParams, body: billFromReceiptBody }),
  asyncHandler(async (req, res) => {
    const { id } = params(req, idParams);
    const b = body(req, billFromReceiptBody);
    const auth = req.auth!;
    // Claim the receipt first so two clicks can't bill it twice.
    const receipt = await GoodsReceiptModel.findOneAndUpdate({ _id: id, billId: null, billing: { $ne: true } }, { $set: { billing: true } }, { new: true }).lean();
    if (!receipt) {
      if (!(await GoodsReceiptModel.exists({ _id: id }))) throw ApiError.notFound();
      throw ApiError.conflict('RECEIPT_ALREADY_BILLED', 'This receipt already has a supplier bill');
    }
    let billId: string | undefined;
    try {
      const billDate = b.billDate ?? (await clinicToday());
      const draft = await ops.createBill(auth, {
        supplierId: String(receipt.supplierId),
        supplierRef: b.supplierRef,
        billDate,
        ...(b.dueDate ? { dueDate: b.dueDate } : {}),
        lines: [{ description: receipt.number, expenseAccountId: await grniAccountId(), amount: receipt.total }],
        notes: receipt.number,
      });
      billId = draft.id;
      const posted = await ops.postBill(auth, draft.id);
      await GoodsReceiptModel.updateOne({ _id: id }, { $set: { billId: draft.id, billing: false } });
      await recordAudit({ action: 'update', entity: 'goodsReceipt', entityId: receipt._id, after: { billId: draft.id } });
      created(res, posted);
    } catch (err) {
      if (billId) await SupplierBillModel.deleteOne({ _id: billId, status: 'draft' });
      await GoodsReceiptModel.updateOne({ _id: id }, { $set: { billing: false } });
      throw err;
    }
  }),
);

registerPath({ method: 'get', path: '/purchase-orders', tags: ['inventory'], summary: 'Purchase orders', query: poQuery });
registerPath({ method: 'post', path: '/purchase-orders', tags: ['inventory'], summary: 'Create a purchase order (no stock, no accounting)', body: purchaseOrderBody });
registerPath({ method: 'post', path: '/purchase-orders/:id/cancel', tags: ['inventory'], summary: 'Cancel an order with nothing received', params: idParams, body: cancelBody });
registerPath({ method: 'get', path: '/goods-receipts', tags: ['inventory'], summary: 'Goods receipts', query: receiptQuery });
registerPath({ method: 'post', path: '/goods-receipts', tags: ['inventory'], summary: 'Receive against a PO (Dr inventory / Cr GRNI)', body: receiptBody });
registerPath({ method: 'post', path: '/goods-receipts/:id/bill', tags: ['inventory'], summary: 'Supplier bill for a receipt (Dr GRNI / Cr AP)', params: idParams, body: billFromReceiptBody });
