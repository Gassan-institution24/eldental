import { Schema, model, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';
import { ADJUSTMENT_TYPES, CONTAINER_POLICIES, CONTAINER_STATUSES, ITEM_TYPES, LOCATION_TYPES, MOVEMENT_TYPES, PO_STATUSES, USAGE_SCOPES } from '@/shared/inventory';

/**
 * Inventory (08b): items, locations, lots, per-location balances, an immutable movement ledger,
 * purchasing (PO → goods receipt → supplier bill), individual containers and clinical usage.
 * Quantities are base units (4 decimals); money is integer minor units.
 */
const ref = (name: string) => ({ type: Schema.Types.ObjectId, ref: name });
const idemKey = { type: String };
const uniqueKey = (schema: Schema) =>
  schema.index({ clinicId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

/* ---------- items & locations ---------- */

const itemSchema = new Schema(
  {
    clinicId: tenantField,
    sku: { type: String, default: '' },
    name: { type: String, required: true },
    searchName: String,
    category: { type: String, default: '' },
    type: { type: String, enum: ITEM_TYPES, default: 'consumable' },
    /** Base unit every quantity is counted in (ml, g, piece…). */
    unit: { type: String, default: 'pcs' },
    /** How it is bought (box, pack…) and how many base units one holds. */
    purchaseUnit: { type: String, default: '' },
    unitsPerPack: { type: Number, default: 1 },
    reorderLevel: { type: Number, default: 0 },
    trackContainers: { type: Boolean, default: false },
    containerPolicy: { type: String, enum: CONTAINER_POLICIES, default: 'none' },
    containerCapacity: Number,
    /** Sum of all balances (kept in the same transaction as each movement). */
    quantityOnHand: { type: Number, default: 0 },
    supplierId: ref('Supplier'),
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventoryItems', optimisticConcurrency: true },
);
applyBase(itemSchema);
itemSchema.index({ clinicId: 1, name: 1 });
itemSchema.index({ clinicId: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: '' } } });
export const InventoryItemModel = model('InventoryItem', itemSchema);
export type InventoryItem = InferSchemaType<typeof itemSchema>;

const locationSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    type: { type: String, enum: LOCATION_TYPES, required: true },
    chairId: ref('Chair'),
    /** Where receipts and opening stock go unless another location is chosen. */
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventoryLocations' },
);
applyBase(locationSchema);
locationSchema.index({ clinicId: 1, name: 1 });
export const InventoryLocationModel = model('InventoryLocation', locationSchema);

/* ---------- lots, balances, movements ---------- */

const batchSchema = new Schema(
  {
    clinicId: tenantField,
    itemId: { ...ref('InventoryItem'), required: true },
    lotNumber: { type: String, default: '' },
    expiresAt: String,
    /** Cost basis: `packCost` minor units for `unitsPerPack` base units. */
    packCost: { type: Number, required: true },
    unitsPerPack: { type: Number, required: true },
    receiptId: ref('GoodsReceipt'),
    supplierId: ref('Supplier'),
    source: { type: String, enum: ['receipt', 'opening'], required: true },
  },
  { timestamps: true, collection: 'inventoryBatches' },
);
applyBase(batchSchema, { softDelete: false });
batchSchema.index({ clinicId: 1, itemId: 1, expiresAt: 1 });
export const InventoryBatchModel = model('InventoryBatch', batchSchema);

const balanceSchema = new Schema(
  {
    clinicId: tenantField,
    locationId: { ...ref('InventoryLocation'), required: true },
    itemId: { ...ref('InventoryItem'), required: true },
    batchId: { ...ref('InventoryBatch'), required: true },
    quantity: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'inventoryBalances' },
);
applyBase(balanceSchema, { softDelete: false, audit: false });
balanceSchema.index({ clinicId: 1, locationId: 1, itemId: 1, batchId: 1 }, { unique: true });
balanceSchema.index({ clinicId: 1, itemId: 1 });
export const StockBalanceModel = model('StockBalance', balanceSchema);

const movementSchema = new Schema(
  {
    clinicId: tenantField,
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    itemId: { ...ref('InventoryItem'), required: true },
    batchId: { ...ref('InventoryBatch'), required: true },
    containerId: ref('InventoryContainer'),
    quantity: { type: Number, required: true },
    cost: { type: Number, default: 0 },
    fromLocationId: ref('InventoryLocation'),
    toLocationId: ref('InventoryLocation'),
    sourceType: { type: String, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    patientId: ref('Patient'),
    date: { type: String, required: true },
    byUserId: Schema.Types.ObjectId,
  },
  { timestamps: true, collection: 'inventoryMovements' },
);
applyBase(movementSchema, { softDelete: false });
movementSchema.index({ clinicId: 1, createdAt: -1 });
movementSchema.index({ clinicId: 1, itemId: 1, createdAt: -1 });
movementSchema.index({ clinicId: 1, sourceType: 1, sourceId: 1 });
export const StockMovementModel = model('InventoryMovement', movementSchema);

/* ---------- physical containers ---------- */

const containerSchema = new Schema(
  {
    clinicId: tenantField,
    code: { type: String, required: true },
    itemId: { ...ref('InventoryItem'), required: true },
    batchId: { ...ref('InventoryBatch'), required: true },
    receiptId: ref('GoodsReceipt'),
    locationId: { ...ref('InventoryLocation'), required: true },
    initialQuantity: { type: Number, required: true },
    remainingQuantity: { type: Number, required: true },
    status: { type: String, enum: CONTAINER_STATUSES, default: 'sealed' },
    policy: { type: String, enum: CONTAINER_POLICIES, required: true },
    openedAt: Date,
    openedBy: Schema.Types.ObjectId,
    beyondUseDate: String,
    closedAt: Date,
  },
  { timestamps: true, collection: 'inventoryContainers', optimisticConcurrency: true },
);
applyBase(containerSchema, { softDelete: false });
containerSchema.index({ clinicId: 1, code: 1 }, { unique: true });
containerSchema.index({ clinicId: 1, locationId: 1, itemId: 1, status: 1 });
export const InventoryContainerModel = model('InventoryContainer', containerSchema);

const containerEventSchema = new Schema(
  {
    clinicId: tenantField,
    containerId: { ...ref('InventoryContainer'), required: true },
    action: { type: String, enum: ['receive', 'open', 'consume', 'transfer', 'discard'], required: true },
    usedQuantity: Number,
    wastedQuantity: Number,
    autoWasteQuantity: Number,
    remainingQuantity: Number,
    fromLocationId: ref('InventoryLocation'),
    toLocationId: ref('InventoryLocation'),
    beyondUseDate: String,
    patientId: ref('Patient'),
    performedProcedureId: ref('PerformedProcedure'),
    usageId: ref('ClinicalUsage'),
    reason: String,
    cost: Number,
    byUserId: Schema.Types.ObjectId,
    at: { type: Date, default: () => new Date() },
    idempotencyKey: idemKey,
  },
  { timestamps: true, collection: 'inventoryContainerEvents' },
);
applyBase(containerEventSchema, { softDelete: false });
containerEventSchema.index({ clinicId: 1, containerId: 1, at: -1 });
uniqueKey(containerEventSchema);
export const ContainerEventModel = model('InventoryContainerEvent', containerEventSchema);

/* ---------- purchasing ---------- */

const poSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    supplierId: { ...ref('Supplier'), required: true },
    date: { type: String, required: true },
    expectedDate: String,
    lines: {
      type: [
        {
          itemId: { ...ref('InventoryItem'), required: true },
          packs: { type: Number, required: true },
          unitsPerPack: { type: Number, required: true },
          packPrice: { type: Number, required: true },
          lineTotal: { type: Number, required: true },
          receivedQuantity: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    total: { type: Number, default: 0 },
    status: { type: String, enum: PO_STATUSES, default: 'open' },
    notes: { type: String, default: '' },
    cancelReason: String,
  },
  { timestamps: true, collection: 'purchaseOrders', optimisticConcurrency: true },
);
applyBase(poSchema);
poSchema.index({ clinicId: 1, number: 1 }, { unique: true });
poSchema.index({ clinicId: 1, status: 1, date: -1 });
export const PurchaseOrderModel = model('PurchaseOrder', poSchema);

const receiptSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    poId: { ...ref('PurchaseOrder'), required: true },
    supplierId: { ...ref('Supplier'), required: true },
    locationId: { ...ref('InventoryLocation'), required: true },
    date: { type: String, required: true },
    lines: {
      type: [
        {
          poLineId: Schema.Types.ObjectId,
          itemId: { ...ref('InventoryItem'), required: true },
          batchId: { ...ref('InventoryBatch'), required: true },
          quantity: { type: Number, required: true },
          packCost: { type: Number, required: true },
          unitsPerPack: { type: Number, required: true },
          cost: { type: Number, required: true },
          lotNumber: String,
          expiresAt: String,
          containers: { type: Number, default: 0 },
          _id: false,
        },
      ],
      default: [],
    },
    total: { type: Number, required: true },
    notes: { type: String, default: '' },
    journalEntryId: ref('JournalEntry'),
    /** The supplier bill that cleared this receipt's GRNI. */
    billId: ref('SupplierBill'),
    billing: { type: Boolean, default: false },
    idempotencyKey: idemKey,
  },
  { timestamps: true, collection: 'goodsReceipts' },
);
applyBase(receiptSchema, { softDelete: false });
receiptSchema.index({ clinicId: 1, number: 1 }, { unique: true });
receiptSchema.index({ clinicId: 1, poId: 1 });
uniqueKey(receiptSchema);
export const GoodsReceiptModel = model('GoodsReceipt', receiptSchema);

/* ---------- transfers & adjustments ---------- */

const stockLine = {
  itemId: { ...ref('InventoryItem'), required: true },
  batchId: { ...ref('InventoryBatch'), required: true },
  quantity: { type: Number, required: true },
  cost: { type: Number, default: 0 },
  _id: false,
};

const transferSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    fromLocationId: { ...ref('InventoryLocation'), required: true },
    toLocationId: { ...ref('InventoryLocation'), required: true },
    date: { type: String, required: true },
    lines: { type: [stockLine], default: [] },
    notes: { type: String, default: '' },
    idempotencyKey: idemKey,
  },
  { timestamps: true, collection: 'inventoryTransfers' },
);
applyBase(transferSchema, { softDelete: false });
uniqueKey(transferSchema);
export const StockTransferModel = model('StockTransfer', transferSchema);

const adjustmentSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    type: { type: String, enum: [...ADJUSTMENT_TYPES, 'opening'], required: true },
    locationId: { ...ref('InventoryLocation'), required: true },
    date: { type: String, required: true },
    reason: { type: String, default: '' },
    lines: { type: [stockLine], default: [] },
    total: { type: Number, default: 0 },
    journalEntryId: ref('JournalEntry'),
    idempotencyKey: idemKey,
  },
  { timestamps: true, collection: 'inventoryAdjustments' },
);
applyBase(adjustmentSchema, { softDelete: false });
uniqueKey(adjustmentSchema);
export const StockAdjustmentModel = model('StockAdjustment', adjustmentSchema);

/* ---------- clinical use ---------- */

const procedureMaterialSchema = new Schema(
  {
    clinicId: tenantField,
    clinicProcedureId: { ...ref('ClinicProcedure'), required: true },
    materials: {
      type: [
        {
          itemId: { ...ref('InventoryItem'), required: true },
          defaultQuantity: { type: Number, required: true },
          usageScope: { type: String, enum: USAGE_SCOPES, default: 'per_procedure' },
          optional: { type: Boolean, default: false },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'procedureMaterials' },
);
applyBase(procedureMaterialSchema, { softDelete: false });
procedureMaterialSchema.index({ clinicId: 1, clinicProcedureId: 1 }, { unique: true });
export const ProcedureMaterialModel = model('ProcedureMaterial', procedureMaterialSchema);

const usageSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    performedProcedureId: { ...ref('PerformedProcedure'), required: true },
    patientId: { ...ref('Patient'), required: true },
    appointmentId: ref('Appointment'),
    dentistId: { ...ref('Staff'), required: true },
    chairId: ref('Chair'),
    clinicProcedureId: ref('ClinicProcedure'),
    toothNumbers: { type: [Number], default: [] },
    locationId: { ...ref('InventoryLocation'), required: true },
    date: { type: String, required: true },
    lines: {
      type: [
        {
          itemId: { ...ref('InventoryItem'), required: true },
          batchId: { ...ref('InventoryBatch'), required: true },
          containerId: ref('InventoryContainer'),
          quantityUsed: { type: Number, default: 0 },
          quantityWasted: { type: Number, default: 0 },
          autoWasteQuantity: { type: Number, default: 0 },
          clinicalCost: { type: Number, default: 0 },
          wasteCost: { type: Number, default: 0 },
          _id: false,
        },
      ],
      default: [],
    },
    clinicalCost: { type: Number, default: 0 },
    wasteCost: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    journalEntryId: ref('JournalEntry'),
    idempotencyKey: idemKey,
  },
  { timestamps: true, collection: 'clinicalUsages' },
);
applyBase(usageSchema, { softDelete: false });
usageSchema.index({ clinicId: 1, performedProcedureId: 1 }, { unique: true });
usageSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
uniqueKey(usageSchema);
export const ClinicalUsageModel = model('ClinicalUsage', usageSchema);
