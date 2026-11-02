import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/config/db';
import { logger } from '@/config/logger';
import '@/modules/seeders';
import { seedCore } from './seedCore';
import { seedDemoData } from './seedDemo';

/** `npm run seed` — idempotent: root superadmin, role templates, catalogs, demo clinic + data. */
async function main(): Promise<void> {
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch(() => undefined)));
  const clinicId = await seedCore();
  await seedDemoData(clinicId);
  logger.info('seed complete — demo users: owner@smile.local / dentist@smile.local / reception@smile.local / accountant@smile.local / hr@smile.local (Password123!); patient portal: patient@smile.local (Password123!)');
  await disconnectDb();
  process.exit(0);
}

main().catch(async (err) => {
  logger.fatal({ err }, 'seed failed');
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
