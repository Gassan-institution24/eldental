import type { AuthContext } from '@/core/auth/auth.types';
import { requestContext } from '@/core/context/requestContext';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { SupplierModel } from '@/modules/accounting/accounting.models';
import { clinicToday } from '@/modules/accounting/journal.service';
import { ChairModel, ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import { registerClinicSeeder } from '@/modules/platform/onboarding.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { toSearchName } from '@/shared/validation/normalize';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { InventoryBatchModel, InventoryItemModel, InventoryLocationModel, ProcedureMaterialModel } from './inventory.models';
import { postOpeningStock } from './inventory.routes';

/** Every clinic starts with one default warehouse, where receipts and opening stock go (08b §2). */
registerClinicSeeder({
  name: 'inventory.locations',
  run: async (_clinic, session) => {
    await InventoryLocationModel.create([{ name: 'Main store', type: 'warehouse', isDefault: true }], { session });
  },
});

type DemoItem = {
  key: string;
  name: string;
  sku: string;
  category: string;
  type: 'consumable' | 'medication';
  unit: string;
  purchaseUnit: string;
  unitsPerPack: number;
  reorderLevel: number;
  containerPolicy?: 'general' | 'multi_dose' | 'single_use';
  containerCapacity?: number;
  /** Opening stock: quantity in base units, cost per base unit (fils), where. */
  opening: { quantity: number; unitCost: number; at: 'store' | 'prep'; lot: string; months: number };
};

const DEMO_ITEMS: DemoItem[] = [
  { key: 'gloves', name: 'Nitrile gloves (M)', sku: 'GLV-M', category: 'Disposables', type: 'consumable', unit: 'piece', purchaseUnit: 'box', unitsPerPack: 100, reorderLevel: 200, opening: { quantity: 600, unitCost: 45, at: 'store', lot: 'GL-2405', months: 24 } },
  { key: 'gauze', name: 'Sterile gauze 5×5', sku: 'GAU-55', category: 'Disposables', type: 'consumable', unit: 'piece', purchaseUnit: 'pack', unitsPerPack: 100, reorderLevel: 100, opening: { quantity: 400, unitCost: 20, at: 'store', lot: 'GZ-118', months: 30 } },
  { key: 'carpule', name: 'Lidocaine 2% carpule 1.8 ml', sku: 'LID-CP', category: 'Anaesthetics', type: 'medication', unit: 'carpule', purchaseUnit: 'box', unitsPerPack: 50, reorderLevel: 50, opening: { quantity: 150, unitCost: 400, at: 'store', lot: 'LD-7731', months: 18 } },
  { key: 'composite', name: 'Composite A2 syringe 4 g', sku: 'CMP-A2', category: 'Restoratives', type: 'consumable', unit: 'g', purchaseUnit: 'syringe', unitsPerPack: 4, reorderLevel: 8, containerPolicy: 'general', containerCapacity: 4, opening: { quantity: 20, unitCost: 3_000, at: 'store', lot: 'CA2-551', months: 20 } },
  { key: 'bonding', name: 'Bonding agent 5 ml', sku: 'BND-5', category: 'Restoratives', type: 'consumable', unit: 'ml', purchaseUnit: 'bottle', unitsPerPack: 5, reorderLevel: 5, containerPolicy: 'general', containerCapacity: 5, opening: { quantity: 15, unitCost: 4_000, at: 'store', lot: 'BD-208', months: 14 } },
  { key: 'vial', name: 'Lidocaine 1% multi-dose vial 20 ml', sku: 'LID-MD', category: 'Anaesthetics', type: 'medication', unit: 'ml', purchaseUnit: 'vial', unitsPerPack: 20, reorderLevel: 20, containerPolicy: 'multi_dose', containerCapacity: 20, opening: { quantity: 60, unitCost: 150, at: 'prep', lot: 'LMD-90', months: 12 } },
  { key: 'irrigant', name: 'Sodium hypochlorite 5.25% single-use 10 ml', sku: 'NAOCL-10', category: 'Endodontics', type: 'consumable', unit: 'ml', purchaseUnit: 'box', unitsPerPack: 100, reorderLevel: 30, containerPolicy: 'single_use', containerCapacity: 10, opening: { quantity: 100, unitCost: 60, at: 'store', lot: 'NA-3310', months: 16 } },
];

/** Procedure code → default materials (quantities in base units). */
const DEMO_TEMPLATES: Record<string, { key: string; quantity: number; scope: 'per_visit' | 'per_procedure' | 'per_tooth' }[]> = {
  D2391: [
    { key: 'gloves', quantity: 2, scope: 'per_visit' },
    { key: 'carpule', quantity: 1, scope: 'per_procedure' },
    { key: 'composite', quantity: 0.3, scope: 'per_tooth' },
    { key: 'bonding', quantity: 0.1, scope: 'per_tooth' },
  ],
  D3330: [
    { key: 'gloves', quantity: 2, scope: 'per_visit' },
    { key: 'carpule', quantity: 2, scope: 'per_procedure' },
    { key: 'irrigant', quantity: 5, scope: 'per_tooth' },
  ],
  D7140: [
    { key: 'gloves', quantity: 2, scope: 'per_visit' },
    { key: 'carpule', quantity: 1, scope: 'per_procedure' },
    { key: 'gauze', quantity: 4, scope: 'per_procedure' },
  ],
  D1110: [
    { key: 'gloves', quantity: 2, scope: 'per_visit' },
    { key: 'gauze', quantity: 2, scope: 'per_visit' },
  ],
};

const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** Demo clinic: a store, a medication preparation area, one location per chair, a catalog and stock. */
registerDemoSeeder({
  name: 'inventory.demo',
  order: 60,
  run: async (clinicId) => {
    await runInTenant(clinicId, async () => {
      // Once: skip clinics that already hold stock lots (items from the old module have none).
      if ((await InventoryBatchModel.exists({})) || (await InventoryItemModel.exists({ sku: { $in: DEMO_ITEMS.map((i) => i.sku) } }))) return;
      const owner = await StaffModel.findOne({ isOwner: true }).lean();
      if (!owner) return;
      const auth = { userId: String(owner.userId), staffId: String(owner._id), clinicId, kind: 'staff', isOwner: true, isRoot: false, permVersion: 0, readOnly: false, grants: {}, tokenId: 'seed' } as AuthContext;
      await requestContext.run({ clinicId, userId: auth.userId, staffId: auth.staffId }, async () => {
        const store =
          (await InventoryLocationModel.findOne({ isDefault: true }).lean()) ?? (await InventoryLocationModel.create({ name: 'Main store', type: 'warehouse', isDefault: true })).toObject();
        const prep = (await InventoryLocationModel.create({ name: 'Medication preparation', type: 'medication_prep' })).toObject();
        for (const chair of await ChairModel.find({ isActive: true }).sort({ name: 1 }).lean()) {
          await InventoryLocationModel.create({ name: chair.name ?? 'Chair', type: 'chair', chairId: chair._id });
        }
        const supplier = await SupplierModel.findOne({ kind: 'supplies' }).select('_id').lean();
        const ids = new Map<string, string>();
        for (const it of DEMO_ITEMS) {
          const doc = await InventoryItemModel.create({
            name: it.name,
            searchName: toSearchName(`${it.name} ${it.sku} ${it.category}`),
            sku: it.sku,
            category: it.category,
            type: it.type,
            unit: it.unit,
            purchaseUnit: it.purchaseUnit,
            unitsPerPack: it.unitsPerPack,
            reorderLevel: it.reorderLevel,
            trackContainers: Boolean(it.containerPolicy),
            containerPolicy: it.containerPolicy ?? 'none',
            containerCapacity: it.containerCapacity,
            supplierId: supplier?._id,
          });
          ids.set(it.key, String(doc._id));
        }
        const today = await clinicToday();
        for (const at of ['store', 'prep'] as const) {
          const lines = DEMO_ITEMS.filter((it) => it.opening.at === at).map((it) => ({
            itemId: ids.get(it.key)!,
            quantity: it.opening.quantity,
            unitCost: it.opening.unitCost,
            lotNumber: it.opening.lot,
            expiresAt: addMonths(today, it.opening.months),
          }));
          if (lines.length) await postOpeningStock(auth, { locationId: String((at === 'store' ? store : prep)._id), lines });
        }
        for (const [code, materials] of Object.entries(DEMO_TEMPLATES)) {
          const proc = await ClinicProcedureModel.findOne({ code }).select('_id').lean();
          if (!proc) continue;
          await ProcedureMaterialModel.create({
            clinicProcedureId: proc._id,
            materials: materials.map((m) => ({ itemId: ids.get(m.key), defaultQuantity: m.quantity, usageScope: m.scope, optional: false })),
          });
        }
      });
    });
  },
});
