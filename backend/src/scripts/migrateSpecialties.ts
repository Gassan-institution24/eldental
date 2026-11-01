import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/config/db';
import { logger } from '@/config/logger';
import { planSpecialtyMigration, type LegacyStaffRow } from '@/modules/staff/specialtyMigration';

/**
 * `npm run migrate:specialties` — dry run: reports what would change and every value it can't map.
 * `-- --apply`    maps recognised values; the old text is kept in `specialtyLegacy`. Unmapped values
 *                 are left exactly as they are (old `specialty` field untouched) for a person to fix.
 * `-- --rollback` restores `specialty` from `specialtyLegacy` and removes the structured fields of
 *                 every migrated record (specialty edits made after the migration are discarded).
 * Works on the raw collection across all clinics; nothing else on the staff record is touched.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rollback = process.argv.includes('--rollback');
  await connectDb();
  const staff = mongoose.connection.collection('staff');

  if (rollback) {
    const migrated = await staff.find({ specialtyLegacy: { $type: 'string' } }).project({ specialtyLegacy: 1 }).toArray();
    logger.info({ records: migrated.length }, 'specialties rollback');
    for (const r of migrated) {
      await staff.updateOne({ _id: r._id }, { $set: { specialty: r.specialtyLegacy }, $unset: { specialties: '', primarySpecialty: '', specialtyLegacy: '' } });
    }
    await disconnectDb();
    return;
  }

  const rows = (await staff.find({ specialty: { $type: 'string', $ne: '' } }).project({ clinicId: 1, name: 1, staffType: 1, specialty: 1, specialties: 1 }).toArray()) as unknown as LegacyStaffRow[];
  const plan = planSpecialtyMigration(rows);
  const maps = plan.filter((p) => p.kind === 'map');
  const unmapped = plan.filter((p) => p.kind === 'unmapped');
  logger.info({ mode: apply ? 'apply' : 'dry-run', found: rows.length, mappable: maps.length, unmapped: unmapped.length }, 'specialties migration plan');
  for (const p of plan) logger.info({ staffId: String(p.id), clinicId: String(p.clinicId), from: p.from, ...(p.kind === 'map' ? { to: p.to } : { reason: p.reason }) }, p.kind === 'map' ? 'will map' : 'needs review (left unchanged)');

  if (apply) {
    for (const p of maps) {
      await staff.updateOne({ _id: p.id as mongoose.Types.ObjectId, specialty: p.from }, { $set: { specialties: [p.to], primarySpecialty: p.to, specialtyLegacy: p.from }, $unset: { specialty: '' } });
    }
    logger.info({ migrated: maps.length }, 'specialties migration applied');
  }
  await disconnectDb();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'specialties migration failed');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
