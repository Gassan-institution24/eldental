import { connectDb } from '@/config/db';
import { logger } from '@/config/logger';
import { startWorkers } from '@/core/jobs/workers';

/** Standalone worker process for production (`npm run worker`). */
async function main(): Promise<void> {
  await connectDb();
  await startWorkers();
  logger.info('workers started');
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
