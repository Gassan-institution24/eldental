// SHARED FILE — synced to the frontend (src/shared/generated/inventory.ts). Inventory rules used by
// both the API and the forms (08b): quantities, costing, container policies and request bodies.
import { z } from 'zod';
import { dateOnly, entityName, enumOf, freeText, money, objectId, optional, requiredText } from './validation/fields';

export const ITEM_TYPES = ['consumable', 'implant', 'medication', 'reusable', 'equipment', 'general'] as const;
/**
 * How individual physical containers (bottles, vials, syringes) are used once opened:
 * none = not tracked one by one; general = used gradually (composite, bonding);
 * multi_dose = injectable labelled multi-dose (clean preparation area + beyond-use date);
 * single_use = whatever is left after the first use is discarded automatically.
 */
export const CONTAINER_POLICIES = ['none', 'general', 'multi_dose', 'single_use'] as const;
export const LOCATION_TYPES = ['warehouse', 'chair', 'medication_prep', 'quarantine'] as const;
export const USAGE_SCOPES = ['per_visit', 'per_procedure', 'per_tooth'] as const;
export const ADJUSTMENT_TYPES = ['waste', 'admin_issue'] as const;
export const CONTAINER_STATUSES = ['sealed', 'open', 'empty', 'discarded'] as const;
export const MOVEMENT_TYPES = [
  'opening',
  'purchase_receipt',
  'transfer',
  'container_transfer',
  'clinical_use',
  'clinical_waste',
  'single_use_remainder',
  'waste',
  'admin_issue',
  'container_discard',
] as const;
export const PO_STATUSES = ['open', 'partially_received', 'received', 'cancelled'] as const;

export type ItemType = (typeof ITEM_TYPES)[number];
export type ContainerPolicy = (typeof CONTAINER_POLICIES)[number];
export type LocationType = (typeof LOCATION_TYPES)[number];
export type UsageScope = (typeof USAGE_SCOPES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Quantities are in the item's base unit (ml, g, piece…) with up to 4 decimals. */
export const QTY_DECIMALS = 4;
const QTY_SCALE = 10 ** QTY_DECIMALS;
export const QTY_MAX = 1_000_000;

export const roundQty = (n: number): number => Math.round(n * QTY_SCALE) / QTY_SCALE;
export const isQty = (n: number): boolean => Number.isFinite(n) && Math.abs(n * QTY_SCALE - Math.round(n * QTY_SCALE)) < 1e-6;

/** A stock quantity: > 0, ≤ 1,000,000, up to 4 decimals. */
export const stockQty = () =>
  z
    .number({ required_error: 'required', invalid_type_error: 'invalid_stock_quantity' })
    .gt(0, { message: 'invalid_stock_quantity' })
    .max(QTY_MAX, { message: 'invalid_stock_quantity' })
    .refine(isQty, { message: 'invalid_stock_quantity' });

/** Same, but 0 is allowed (used + wasted lines where one side is empty). */
export const stockQtyOrZero = () =>
  z
    .number({ required_error: 'required', invalid_type_error: 'invalid_stock_quantity' })
    .min(0, { message: 'invalid_stock_quantity' })
    .max(QTY_MAX, { message: 'invalid_stock_quantity' })
    .refine(isQty, { message: 'invalid_stock_quantity' });

/**
 * Cost of `qty` base units from a lot bought at `packCost` (minor units) per pack of
 * `unitsPerPack` base units. Exact rational arithmetic, rounded half-even to the minor unit.
 */
export function costOf(qty: number, packCost: number, unitsPerPack: number): number {
  if (!Number.isSafeInteger(packCost) || packCost < 0) throw new RangeError('packCost must be a non-negative integer');
  const num = BigInt(Math.round(qty * QTY_SCALE)) * BigInt(packCost);
  const den = BigInt(Math.round(unitsPerPack * QTY_SCALE));
  if (den <= 0n) throw new RangeError('unitsPerPack must be positive');
  let q = num / den;
  const twice = (num % den) * 2n;
  if (twice > den || (twice === den && q % 2n === 1n)) q += 1n;
  return Number(q);
}

/** Whole containers in `qty` base units, or null when it isn't a whole number of them. */
export function containerCount(qty: number, capacity: number): number | null {
  const scaledQty = Math.round(qty * QTY_SCALE);
  const scaledCap = Math.round(capacity * QTY_SCALE);
  if (scaledCap <= 0 || scaledQty % scaledCap !== 0) return null;
  return scaledQty / scaledCap;
}

/**
 * Drawing from one opened container. Single-use containers lose whatever is left after the
 * first draw (automatic waste); other containers keep the remainder.
 */
export function planContainerDraw(remaining: number, used: number, wasted: number, policy: ContainerPolicy): { used: number; wasted: number; autoWaste: number; remaining: number } | null {
  const take = roundQty(used + wasted);
  if (take <= 0 || take > roundQty(remaining)) return null;
  const left = roundQty(remaining - take);
  const autoWaste = policy === 'single_use' ? left : 0;
  return { used: roundQty(used), wasted: roundQty(wasted), autoWaste, remaining: policy === 'single_use' ? 0 : left };
}

/** Suggested quantity of a template material for a performed procedure. */
export function suggestedQuantity(defaultQuantity: number, scope: UsageScope, procedure: { quantity?: number; toothCount?: number }): number {
  const times = scope === 'per_tooth' ? Math.max(1, procedure.toothCount ?? 0) : scope === 'per_procedure' ? Math.max(1, procedure.quantity ?? 1) : 1;
  return roundQty(defaultQuantity * times);
}

/* ---------- request bodies ---------- */

const sku = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{1,29}$/, { message: 'invalid_format' }),
  );
const unitName = () => requiredText(20);

const itemShape = {
  name: entityName({ max: 120 }),
  sku: optional(sku()),
  category: optional(freeText(60)),
  type: enumOf([...ITEM_TYPES]).default('consumable'),
  unit: unitName(),
  purchaseUnit: optional(freeText(20)),
  unitsPerPack: stockQty().default(1),
  reorderLevel: stockQtyOrZero().default(0),
  trackContainers: z.boolean().default(false),
  containerPolicy: enumOf([...CONTAINER_POLICIES]).default('none'),
  containerCapacity: optional(stockQty()),
  supplierId: optional(objectId()),
  notes: optional(freeText(500)),
  isActive: z.boolean().default(true),
};

/** Container tracking needs a policy and a capacity that fits a whole number of times in a pack. */
export function checkItemContainers(v: { trackContainers?: boolean; containerPolicy?: ContainerPolicy; containerCapacity?: number; unitsPerPack?: number; type?: ItemType }, ctx: z.RefinementCtx) {
  if (v.trackContainers === undefined && v.containerPolicy === undefined) return;
  if (Boolean(v.trackContainers) !== (v.containerPolicy !== undefined && v.containerPolicy !== 'none')) {
    ctx.addIssue({ code: 'custom', path: ['containerPolicy'], message: 'container_policy_mismatch' });
    return;
  }
  if (!v.trackContainers) return;
  if (v.type === 'reusable' || v.type === 'equipment') ctx.addIssue({ code: 'custom', path: ['trackContainers'], message: 'invalid_option' });
  const capacity = v.containerCapacity ?? v.unitsPerPack;
  if (!capacity) ctx.addIssue({ code: 'custom', path: ['containerCapacity'], message: 'required' });
  else if (v.unitsPerPack !== undefined && containerCount(v.unitsPerPack, capacity) === null) ctx.addIssue({ code: 'custom', path: ['containerCapacity'], message: 'capacity_must_divide_pack' });
}

export const itemCreateBody = z.object(itemShape).strict().superRefine(checkItemContainers);
export const locationBody = z
  .object({
    name: entityName({ max: 80 }),
    type: enumOf([...LOCATION_TYPES]),
    chairId: optional(objectId()),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'chair' && !v.chairId) ctx.addIssue({ code: 'custom', path: ['chairId'], message: 'required' });
    if (v.isDefault && v.type !== 'warehouse') ctx.addIssue({ code: 'custom', path: ['isDefault'], message: 'invalid_option' });
  });

export const purchaseOrderBody = z
  .object({
    supplierId: objectId(),
    date: optional(dateOnly()),
    expectedDate: optional(dateOnly()),
    notes: optional(freeText(1000)),
    lines: z
      .array(
        z
          .object({
            itemId: objectId(),
            packs: z.number({ invalid_type_error: 'invalid_quantity' }).int({ message: 'invalid_quantity' }).min(1, { message: 'invalid_quantity' }).max(10_000, { message: 'invalid_quantity' }),
            packPrice: money({ positive: true }),
          })
          .strict(),
      )
      .min(1, { message: 'too_few' })
      .max(100, { message: 'too_many' }),
  })
  .strict();

export const receiptBody = z
  .object({
    poId: objectId(),
    locationId: objectId(),
    date: optional(dateOnly()),
    notes: optional(freeText(500)),
    lines: z
      .array(
        z
          .object({
            poLineId: objectId(),
            quantity: stockQty(),
            lotNumber: requiredText(40),
            expiresAt: optional(dateOnly()),
          })
          .strict(),
      )
      .min(1, { message: 'too_few' })
      .max(100, { message: 'too_many' }),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.lines.forEach((l, i) => {
      if (seen.has(l.poLineId)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'poLineId'], message: 'duplicate' });
      seen.add(l.poLineId);
    });
  });

export const billFromReceiptBody = z
  .object({ supplierRef: requiredText(60), billDate: optional(dateOnly()), dueDate: optional(dateOnly()) })
  .strict();

const stockLine = z.object({ itemId: objectId(), batchId: objectId(), quantity: stockQty() }).strict();

export const transferBody = z
  .object({
    fromLocationId: objectId(),
    toLocationId: objectId(),
    notes: optional(freeText(500)),
    lines: z.array(stockLine).min(1, { message: 'too_few' }).max(100, { message: 'too_many' }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fromLocationId === v.toLocationId) ctx.addIssue({ code: 'custom', path: ['toLocationId'], message: 'same_location' });
  });

export const adjustmentBody = z
  .object({
    type: enumOf([...ADJUSTMENT_TYPES]),
    locationId: objectId(),
    reason: requiredText(500).refine((s) => s.length >= 5, { message: 'too_short' }),
    lines: z.array(stockLine).min(1, { message: 'too_few' }).max(100, { message: 'too_many' }),
  })
  .strict();

/** Stock the clinic already holds when it starts using the module (Dr Inventory / Cr Opening balance). */
export const openingStockBody = z
  .object({
    locationId: objectId(),
    date: optional(dateOnly()),
    lines: z
      .array(
        z
          .object({
            itemId: objectId(),
            quantity: stockQty(),
            unitCost: money(),
            lotNumber: optional(freeText(40)),
            expiresAt: optional(dateOnly()),
          })
          .strict(),
      )
      .min(1, { message: 'too_few' })
      .max(200, { message: 'too_many' }),
  })
  .strict();

export const containerOpenBody = z.object({ beyondUseDate: optional(dateOnly()) }).strict();
export const containerTransferBody = z.object({ toLocationId: objectId() }).strict();
export const containerDiscardBody = z.object({ reason: requiredText(500).refine((s) => s.length >= 5, { message: 'too_short' }) }).strict();

export const procedureMaterialsBody = z
  .object({
    materials: z
      .array(
        z
          .object({
            itemId: objectId(),
            defaultQuantity: stockQty(),
            usageScope: enumOf([...USAGE_SCOPES]).default('per_procedure'),
            optional: z.boolean().default(false),
          })
          .strict(),
      )
      .max(50, { message: 'too_many' }),
  })
  .strict();

export const clinicalUsageBody = z
  .object({
    performedProcedureId: objectId(),
    locationId: objectId(),
    notes: optional(freeText(500)),
    lines: z
      .array(
        z
          .object({
            itemId: objectId(),
            batchId: optional(objectId()),
            containerId: optional(objectId()),
            quantityUsed: stockQtyOrZero(),
            quantityWasted: stockQtyOrZero().default(0),
          })
          .strict()
          .superRefine((l, ctx) => {
            if (roundQty(l.quantityUsed + (l.quantityWasted ?? 0)) <= 0) ctx.addIssue({ code: 'custom', path: ['quantityUsed'], message: 'invalid_stock_quantity' });
          }),
      )
      .min(1, { message: 'too_few' })
      .max(50, { message: 'too_many' }),
  })
  .strict();
