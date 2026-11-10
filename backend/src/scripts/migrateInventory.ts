import mongoose, { Types } from 'mongoose';
import { connectDb, disconnectDb } from '@/config/db';
import { logger } from '@/config/logger';
import { bumpPermVersion } from '@/core/rbac/permission.service';
import { ROLE_TEMPLATES } from '@/core/rbac/roleTemplates';

/**
 * `npm run migrate:inventory` — dry run: reports what would change, per clinic.
 * `-- --apply` makes the changes. Safe to run again (each step skips what is already done):
 *  1. a default "Main store" location for clinics that have none;
 *  2. items from the old inventory (on-hand quantity, average cost, no lots) get one opening lot at
 *     that store. No journal entry: the old module already posted their value to INVENTORY;
 *  3. the new inventory grants of the role templates are added to each clinic's system roles
 *     (dentist, hygienist, assistant, receptionist, accountant). Existing grants are not touched.
 * Works on the raw collections across all clinics.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectDb();
  const db = mongoose.connection.db!;
  const clinics = await db.collection('clinics').find({}).project({ name: 1 }).toArray();
  const summary = { clinics: clinics.length, stores: 0, legacyItems: 0, roleGrants: 0 };

  for (const clinic of clinics) {
    const clinicId = clinic._id as Types.ObjectId;
    const log = (msg: string, extra: Record<string, unknown> = {}) => logger.info({ clinic: clinic.name, ...extra }, msg);

    // 1. default store
    const locations = db.collection('inventoryLocations');
    let store = await locations.findOne({ clinicId, isDefault: true, deletedAt: null });
    if (!store) {
      summary.stores += 1;
      log('will create the default "Main store" location');
      if (apply) {
        const doc = { _id: new Types.ObjectId(), clinicId, name: 'Main store', type: 'warehouse', isDefault: true, isActive: true, createdAt: new Date(), updatedAt: new Date() };
        await locations.insertOne(doc);
        store = doc;
      }
    }

    // 2. legacy items with stock but no lots
    const items = await db.collection('inventoryItems').find({ clinicId, quantityOnHand: { $gt: 0 } }).toArray();
    for (const item of items) {
      if (await db.collection('inventoryBatches').findOne({ clinicId, itemId: item._id })) continue;
      summary.legacyItems += 1;
      const unitCost = Math.max(0, Math.round(Number(item.averageCost ?? 0)));
      log('will give the old item an opening lot', { item: item.name, quantity: item.quantityOnHand, unitCost });
      if (!apply || !store) continue;
      const batchId = new Types.ObjectId();
      const now = new Date();
      await db.collection('inventoryBatches').insertOne({ _id: batchId, clinicId, itemId: item._id, lotNumber: '', packCost: unitCost, unitsPerPack: 1, source: 'opening', createdAt: now, updatedAt: now });
      await db.collection('inventoryBalances').insertOne({ clinicId, locationId: store._id, itemId: item._id, batchId, quantity: item.quantityOnHand, createdAt: now, updatedAt: now });
      await db.collection('inventoryMovements').insertOne({
        clinicId,
        type: 'opening',
        itemId: item._id,
        batchId,
        quantity: item.quantityOnHand,
        cost: Math.round(Number(item.quantityOnHand) * unitCost),
        toLocationId: store._id,
        sourceType: 'migration',
        sourceId: batchId,
        date: now.toISOString().slice(0, 10),
        createdAt: now,
        updatedAt: now,
      });
      await db.collection('inventoryItems').updateOne(
        { _id: item._id },
        { $set: { unitsPerPack: item.unitsPerPack ?? 1, type: item.type ?? 'consumable', trackContainers: false, containerPolicy: 'none' } },
      );
    }

    // 3. inventory grants for the clinic's system roles
    let rolesChanged = false;
    for (const tpl of ROLE_TEMPLATES) {
      if (tpl.key === 'owner') continue; // the owner bypasses permission checks
      const wanted = tpl.permissions.filter((g) => g.permission.startsWith('inventory.'));
      if (!wanted.length) continue;
      const role = await db.collection('roles').findOne({ clinicId, systemKey: tpl.systemKey, deletedAt: null });
      if (!role) continue;
      const have = new Set(((role.permissions ?? []) as { permission: string }[]).map((g) => g.permission));
      const missing = wanted.filter((g) => !have.has(g.permission));
      if (!missing.length) continue;
      summary.roleGrants += missing.length;
      log('will add inventory permissions to role', { role: tpl.key, permissions: missing.map((g) => `${g.permission}:${g.scope}`) });
      if (apply) {
        await db.collection('roles').updateOne({ _id: role._id }, { $push: { permissions: { $each: missing } } } as never);
        rolesChanged = true;
      }
    }
    if (rolesChanged) await bumpPermVersion(clinicId);
  }

  logger.info({ mode: apply ? 'apply' : 'dry-run', ...summary }, 'inventory migration');
  await disconnectDb();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'inventory migration failed');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
