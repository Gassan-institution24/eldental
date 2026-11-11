import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/config/db';
import { logger } from '@/config/logger';
import { syncCatalogs } from '@/modules/clinic/clinic.seeders';
import { syncRoleTemplates } from '@/modules/roles/roles.service';
import '@/modules/seeders';
import { seedRootSuperadmin } from './seedCore';

/**
 * `npm run seed:admin` — for a real (empty) database: indexes, role templates, global catalogs
 * (procedures, tooth conditions, medicines) and the root superadmin from SEED_SUPERADMIN_EMAIL /
 * SEED_SUPERADMIN_PASSWORD. No demo clinic, users or patients. Safe to run again.
 */
async function main(): Promise<void> {
  await connectDb();
  // autoIndex is off in production: create the declared indexes on a fresh database.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch(() => undefined)));
  await syncRoleTemplates();
  await syncCatalogs();
  await seedRootSuperadmin();
  logger.info('seed:admin complete — sign in as the superadmin and create your clinics');
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.fatal({ err }, 'seed:admin failed');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
