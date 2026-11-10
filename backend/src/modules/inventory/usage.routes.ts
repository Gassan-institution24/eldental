import { Router } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { withTransaction } from '@/core/db/transaction';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { body, query, validate } from '@/core/validation/validate';
import { clinicToday } from '@/modules/accounting/journal.service';
import { ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import { PerformedProcedureModel } from '@/modules/clinical/clinical.models';
import { onPatientMerge } from '@/modules/patients/patient.service';
import { AppointmentModel } from '@/modules/scheduling/scheduling.models';
import { StaffModel } from '@/modules/staff/staff.model';
import { sum } from '@/shared/money';
import { clinicalUsageBody, costOf, planContainerDraw, roundQty, suggestedQuantity, type UsageScope } from '@/shared/inventory';
import { objectId, optional } from '@/shared/validation/fields';
import { postInventoryEntry } from './inventory.accounts';
import {
  ClinicalUsageModel,
  ContainerEventModel,
  InventoryBatchModel,
  InventoryContainerModel,
  InventoryItemModel,
  InventoryLocationModel,
  ProcedureMaterialModel,
  StockBalanceModel,
  StockMovementModel,
} from './inventory.models';
import { stockCtx } from './inventory.routes';
import { canSeeCost, loadBatch, loadItem, loadLocation, move, notifyLowStockAfterCommit, once, sess, type StockCtx } from './stock.service';

/**
 * Clinical usage (08b §5): the materials actually used on a performed procedure. Posting
 * deducts stock (Dr Clinical materials, Dr Waste / Cr Inventory). A planned treatment never
 * deducts stock, and used material is never put back on cancellation.
 */
export const usageRouter = Router();

const key = (req: { header: (h: string) => string | undefined }) => req.header('idempotency-key')?.slice(0, 100) || undefined;

/** Own scope: the dentist who performed it, or an assistant on it. */
function ownsProcedure(auth: AuthContext, p: { dentistId?: unknown; assistantIds?: unknown[] }) {
  return String(p.dentistId) === auth.staffId || (p.assistantIds ?? []).some((a) => String(a) === auth.staffId);
}

async function loadProcedure(auth: AuthContext, id: string, permission: string, session?: ClientSession) {
  const p = await PerformedProcedureModel.findById(id).session(session ?? null).lean();
  if (!p || (scopeFor(auth, permission) === 'own' && !ownsProcedure(auth, p))) throw ApiError.notFound();
  return p;
}

/* ---------- picking a procedure and its suggested materials ---------- */

const candidatesQuery = z.object({ patientId: objectId() }).strict();

/** The patient's performed procedures, newest first, with whether materials were recorded. */
usageRouter.get(
  '/clinical-usages/procedures',
  authorize('inventory.usage.record', 'inventory.usage.read'),
  validate({ query: candidatesQuery }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const q = query(req, candidatesQuery);
    const own = scopeFor(auth, 'inventory.usage.record') === 'own' || (scopeFor(auth, 'inventory.usage.read') === 'own' && !scopeFor(auth, 'inventory.usage.record'));
    const me = auth.staffId ? new Types.ObjectId(auth.staffId) : null;
    const rows = await PerformedProcedureModel.find({ patientId: q.patientId, status: 'completed', ...(own && me ? { $or: [{ dentistId: me }, { assistantIds: me }] } : {}) })
      .sort({ performedAt: -1 })
      .limit(100)
      .lean();
    const [procs, dentists, usages] = await Promise.all([
      ClinicProcedureModel.find({ _id: { $in: rows.map((r) => r.clinicProcedureId) } }).select('code name systemKey').lean(),
      StaffModel.find({ _id: { $in: rows.map((r) => r.dentistId) } }).select('name').lean(),
      ClinicalUsageModel.find({ performedProcedureId: { $in: rows.map((r) => r._id) } }).select('performedProcedureId number').lean(),
    ]);
    const proc = new Map(procs.map((p) => [String(p._id), { code: p.code, name: p.name, systemKey: p.systemKey }]));
    const dentist = new Map(dentists.map((d) => [String(d._id), d.name]));
    const used = new Map(usages.map((u) => [String(u.performedProcedureId), u.number]));
    ok(
      res,
      rows.map((r) => ({
        id: String(r._id),
        clinicProcedureId: String(r.clinicProcedureId),
        code: r.code ?? proc.get(String(r.clinicProcedureId))?.code ?? '',
        procedure: proc.get(String(r.clinicProcedureId)) ?? null,
        toothNumbers: r.toothNumbers ?? [],
        quantity: r.quantity ?? 1,
        performedAt: r.performedAt,
        dentistId: String(r.dentistId),
        dentistName: dentist.get(String(r.dentistId)) ?? '',
        usageNumber: used.get(String(r._id)),
      })),
    );
  }),
);

const suggestQuery = z.object({ performedProcedureId: objectId(), locationId: objectId() }).strict();

/** Template materials with quantities scaled to the procedure, plus the lot/container to use (FEFO). */
usageRouter.get(
  '/clinical-usages/suggestions',
  authorize('inventory.usage.record'),
  validate({ query: suggestQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, suggestQuery);
    const p = await loadProcedure(req.auth!, q.performedProcedureId, 'inventory.usage.record');
    const today = await clinicToday();
    const tpl = await ProcedureMaterialModel.findOne({ clinicProcedureId: p.clinicProcedureId }).lean();
    const materials = tpl?.materials ?? [];
    const items = await InventoryItemModel.find({ _id: { $in: materials.map((m) => m.itemId) } }).select('name unit trackContainers containerPolicy').lean();
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    const out = [];
    for (const m of materials) {
      const it = itemById.get(String(m.itemId));
      if (!it) continue;
      const quantity = suggestedQuantity(m.defaultQuantity, m.usageScope as UsageScope, { quantity: p.quantity ?? 1, toothCount: (p.toothNumbers ?? []).length });
      let batchId: string | undefined;
      let containerId: string | undefined;
      if (it.trackContainers) {
        const containers = await InventoryContainerModel.find({ itemId: m.itemId, locationId: q.locationId, status: 'open' }).sort({ openedAt: 1 }).lean();
        const usable = containers.find((c) => (!c.beyondUseDate || c.beyondUseDate >= today) && c.remainingQuantity > 0);
        containerId = usable ? String(usable._id) : undefined;
        batchId = usable ? String(usable.batchId) : undefined;
      } else {
        const balances = await StockBalanceModel.find({ itemId: m.itemId, locationId: q.locationId, quantity: { $gt: 0 } }).lean();
        const batches = await InventoryBatchModel.find({ _id: { $in: balances.map((b) => b.batchId) } }).select('expiresAt').lean();
        const exp = new Map(batches.map((b) => [String(b._id), b.expiresAt]));
        const fefo = balances
          .filter((b) => !exp.get(String(b.batchId)) || exp.get(String(b.batchId))! >= today)
          .sort((a, b) => (exp.get(String(a.batchId)) ?? '9999').localeCompare(exp.get(String(b.batchId)) ?? '9999'));
        batchId = (fefo.find((b) => b.quantity >= quantity) ?? fefo[0])?.batchId?.toString();
      }
      out.push({ itemId: String(m.itemId), itemName: it.name, unit: it.unit, trackContainers: Boolean(it.trackContainers), containerPolicy: it.containerPolicy, quantity, usageScope: m.usageScope, optional: Boolean(m.optional), batchId, containerId });
    }
    ok(res, out);
  }),
);

/* ---------- posting ---------- */

/** First-expiry-first-out lot at the location with enough stock for `qty`. */
async function pickBatch(ctx: StockCtx, itemId: Types.ObjectId, locationId: Types.ObjectId, qty: number) {
  const balances = await StockBalanceModel.find({ itemId, locationId, quantity: { $gte: qty } }).session(sess(ctx)).lean();
  const batches = await InventoryBatchModel.find({ _id: { $in: balances.map((b) => b.batchId) } }).session(sess(ctx)).lean();
  const fresh = batches.filter((b) => !b.expiresAt || b.expiresAt >= ctx.date).sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'));
  if (!fresh[0]) throw ApiError.conflict('INSUFFICIENT_STOCK', 'No unexpired lot at this location has enough stock');
  return fresh[0];
}

usageRouter.post(
  '/clinical-usages',
  authorize('inventory.usage.record'),
  validate({ body: clinicalUsageBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, clinicalUsageBody);
    const auth = req.auth!;
    const doc = await once(
      key(req),
      (k) => ClinicalUsageModel.findOne({ idempotencyKey: k }).lean<Record<string, unknown>>(),
      () =>
        withTransaction(async (session) => {
          const ctx = await stockCtx(auth, session);
          const p = await loadProcedure(auth, b.performedProcedureId, 'inventory.usage.record', session);
          if (p.status !== 'completed') throw ApiError.conflict('PROCEDURE_VOIDED', 'This procedure was voided');
          if (await ClinicalUsageModel.exists({ performedProcedureId: p._id }).session(sess(ctx))) throw ApiError.conflict('USAGE_ALREADY_POSTED', 'Materials were already recorded for this procedure');
          const loc = await loadLocation(ctx, b.locationId);
          const id = new Types.ObjectId();
          const lines = [];
          for (const [i, l] of b.lines.entries()) {
            const item = await loadItem(ctx, l.itemId);
            if (item.type === 'reusable' || item.type === 'equipment') throw ApiError.conflict('NOT_CONSUMABLE', 'Reusable instruments and equipment are not consumed', { line: i });
            let used = roundQty(l.quantityUsed);
            let wasted = roundQty(l.quantityWasted ?? 0);
            let autoWaste = 0;
            let batchId: Types.ObjectId;
            let containerId: Types.ObjectId | undefined;
            if (item.trackContainers) {
              if (!l.containerId) throw ApiError.conflict('CONTAINER_REQUIRED', 'Pick the opened container the material came from', { line: i });
              const c = await InventoryContainerModel.findOne({ _id: l.containerId, itemId: item._id }).session(sess(ctx));
              if (!c || String(c.locationId) !== String(loc._id)) throw ApiError.validation([{ path: `lines.${i}.containerId`, code: 'not_found' }]);
              if (c.status !== 'open') throw ApiError.conflict('CONTAINER_NOT_OPEN', 'Open the container before using it', { line: i, code: c.code });
              if (c.policy === 'multi_dose' && (loc.type !== 'medication_prep' || !c.beyondUseDate)) throw ApiError.conflict('CONTAINER_POLICY_VIOLATION', 'Multi-dose containers are drawn in a medication preparation area with a beyond-use date', { rule: 'multi_dose_prep_area', line: i });
              if (c.beyondUseDate && c.beyondUseDate < ctx.date) throw ApiError.conflict('CONTAINER_BEYOND_USE', 'This opened container is past its beyond-use date', { line: i, code: c.code, beyondUseDate: c.beyondUseDate });
              await loadBatch(ctx, item._id, c.batchId);
              const plan = planContainerDraw(c.remainingQuantity, used, wasted, c.policy as never);
              if (!plan) throw ApiError.conflict('INSUFFICIENT_STOCK', 'The container does not hold that much', { line: i, available: c.remainingQuantity });
              ({ used, wasted, autoWaste } = plan);
              c.remainingQuantity = plan.remaining;
              if (plan.remaining === 0) {
                c.status = autoWaste > 0 ? 'discarded' : 'empty';
                c.closedAt = new Date();
              }
              await c.save({ session });
              batchId = c.batchId;
              containerId = c._id;
              await ContainerEventModel.create(
                [{ containerId: c._id, action: 'consume', usedQuantity: used, wastedQuantity: wasted, autoWasteQuantity: autoWaste, remainingQuantity: plan.remaining, patientId: p.patientId, performedProcedureId: p._id, usageId: id, byUserId: auth.userId }],
                { session },
              );
            } else {
              if (l.containerId) throw ApiError.validation([{ path: `lines.${i}.containerId`, code: 'invalid_option' }]);
              const batch = l.batchId ? await loadBatch(ctx, item._id, l.batchId) : await pickBatch(ctx, item._id, loc._id, roundQty(used + wasted));
              batchId = batch._id;
            }
            const batch = await loadBatch(ctx, item._id, batchId, { allowExpired: true });
            const wasteQty = roundQty(wasted + autoWaste);
            const clinicalCost = costOf(used, batch.packCost, batch.unitsPerPack);
            const wasteCost = costOf(wasteQty, batch.packCost, batch.unitsPerPack);
            const common = { itemId: item._id, batchId, containerId, from: loc._id, sourceType: 'clinical_usage', sourceId: id, patientId: p.patientId };
            if (used > 0) await move(ctx, { ...common, type: 'clinical_use', quantity: used, cost: clinicalCost });
            if (wasteQty > 0) await move(ctx, { ...common, type: autoWaste > 0 ? 'single_use_remainder' : 'clinical_waste', quantity: wasteQty, cost: wasteCost });
            lines.push({ itemId: item._id, batchId, containerId, quantityUsed: used, quantityWasted: wasted, autoWasteQuantity: autoWaste, clinicalCost, wasteCost });
          }
          const clinicalCost = sum(lines.map((l) => l.clinicalCost));
          const wasteCost = sum(lines.map((l) => l.wasteCost));
          const number = await nextNumber('clinicalUsage', 'USE', { year: Number(ctx.date.slice(0, 4)), session });
          const je =
            clinicalCost + wasteCost > 0
              ? await postInventoryEntry(
                  auth,
                  {
                    date: ctx.date,
                    sourceId: id,
                    memo: `${number} · ${p.code ?? ''}`,
                    lines: [
                      { key: 'CLINICAL_MATERIALS', debit: clinicalCost },
                      { key: 'INVENTORY_WASTE', debit: wasteCost },
                      { key: 'INVENTORY', credit: clinicalCost + wasteCost },
                    ],
                  },
                  session,
                )
              : null;
          const appt = p.appointmentId ? await AppointmentModel.findById(p.appointmentId).select('chairId').session(sess(ctx)).lean() : null;
          const [usage] = await ClinicalUsageModel.create(
            [
              {
                _id: id,
                number,
                performedProcedureId: p._id,
                patientId: p.patientId,
                appointmentId: p.appointmentId,
                dentistId: p.dentistId,
                chairId: appt?.chairId,
                clinicProcedureId: p.clinicProcedureId,
                toothNumbers: p.toothNumbers ?? [],
                locationId: loc._id,
                date: ctx.date,
                lines,
                clinicalCost,
                wasteCost,
                total: clinicalCost + wasteCost,
                notes: b.notes ?? '',
                journalEntryId: je?._id,
                idempotencyKey: key(req),
              },
            ],
            { session },
          );
          notifyLowStockAfterCommit(ctx);
          return usage!.toObject();
        }),
    );
    await recordAudit({ action: 'create', entity: 'clinicalUsage', entityId: doc._id as Types.ObjectId, after: { lines: (doc.lines as unknown[]).length } });
    created(res, (await usageDtos(auth, [doc as never]))[0]);
  }),
);

/* ---------- history ---------- */

async function usageDtos(auth: AuthContext, rows: Record<string, unknown>[]) {
  const lines = rows.flatMap((r) => r.lines as Record<string, unknown>[]);
  const [items, batches, containers, locations, dentists] = await Promise.all([
    InventoryItemModel.find({ _id: { $in: lines.map((l) => l.itemId) } }).select('name unit').lean(),
    InventoryBatchModel.find({ _id: { $in: lines.map((l) => l.batchId) } }).select('lotNumber').lean(),
    InventoryContainerModel.find({ _id: { $in: lines.map((l) => l.containerId).filter(Boolean) } }).select('code').lean(),
    InventoryLocationModel.find({ _id: { $in: rows.map((r) => r.locationId) } }).select('name').lean(),
    StaffModel.find({ _id: { $in: rows.map((r) => r.dentistId) } }).select('name').lean(),
  ]);
  const name = new Map([...items, ...locations, ...dentists].map((d) => [String(d._id), d.name]));
  const unit = new Map(items.map((i) => [String(i._id), i.unit]));
  const lot = new Map(batches.map((b) => [String(b._id), b.lotNumber]));
  const code = new Map(containers.map((c) => [String(c._id), c.code]));
  const cost = canSeeCost(auth);
  return rows.map((r) => ({
    id: String(r._id),
    number: r.number,
    date: r.date,
    performedProcedureId: String(r.performedProcedureId),
    patientId: String(r.patientId),
    dentistId: String(r.dentistId),
    dentistName: name.get(String(r.dentistId)) ?? '',
    locationId: String(r.locationId),
    locationName: name.get(String(r.locationId)) ?? '',
    toothNumbers: r.toothNumbers,
    notes: r.notes,
    ...(cost ? { clinicalCost: r.clinicalCost, wasteCost: r.wasteCost, total: r.total } : {}),
    lines: (r.lines as Record<string, unknown>[]).map((l) => ({
      itemId: String(l.itemId),
      itemName: name.get(String(l.itemId)) ?? '',
      unit: unit.get(String(l.itemId)) ?? '',
      lotNumber: lot.get(String(l.batchId)) ?? '',
      containerCode: l.containerId ? code.get(String(l.containerId)) : undefined,
      quantityUsed: l.quantityUsed,
      quantityWasted: l.quantityWasted,
      autoWasteQuantity: l.autoWasteQuantity,
      ...(cost ? { clinicalCost: l.clinicalCost, wasteCost: l.wasteCost } : {}),
    })),
  }));
}

const listQuery = z.object({ patientId: optional(objectId()), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();

usageRouter.get(
  '/clinical-usages',
  authorize('inventory.usage.read'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const q = query(req, listQuery);
    const own = scopeFor(auth, 'inventory.usage.read') === 'own';
    const filter: Record<string, unknown> = { ...(q.patientId ? { patientId: q.patientId } : {}) };
    if (own) {
      const me = new Types.ObjectId(auth.staffId);
      const mine = await PerformedProcedureModel.find({ $or: [{ dentistId: me }, { assistantIds: me }], ...(q.patientId ? { patientId: q.patientId } : {}) }).select('_id').limit(5000).lean();
      filter.performedProcedureId = { $in: mine.map((m) => m._id) };
    }
    const rows = await ClinicalUsageModel.find(filter).sort({ createdAt: -1 }).limit(q.limit).lean();
    ok(res, await usageDtos(auth, rows as never));
  }),
);

onPatientMerge(async (sourceId, targetId) => {
  await ClinicalUsageModel.updateMany({ patientId: sourceId }, { $set: { patientId: targetId } });
  await StockMovementModel.updateMany({ patientId: sourceId }, { $set: { patientId: targetId } });
  await ContainerEventModel.updateMany({ patientId: sourceId }, { $set: { patientId: targetId } });
});

registerPath({ method: 'get', path: '/clinical-usages/procedures', tags: ['inventory'], summary: "A patient's performed procedures for recording materials", query: candidatesQuery });
registerPath({ method: 'get', path: '/clinical-usages/suggestions', tags: ['inventory'], summary: 'Suggested materials for a performed procedure', query: suggestQuery });
registerPath({ method: 'post', path: '/clinical-usages', tags: ['inventory'], summary: 'Record the materials used (Dr clinical materials + waste / Cr inventory)', body: clinicalUsageBody });
registerPath({ method: 'get', path: '/clinical-usages', tags: ['inventory'], summary: 'Recorded clinical usage', query: listQuery });
