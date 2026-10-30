import { connectDb } from '@/config/db';
import { probeRedis } from '@/config/redis';
import { logger } from '@/config/logger';
import { startWorkers } from '@/core/jobs/workers';

/** Standalone worker process for production (`npm run worker`). */
async function main(): Promise<void> {
  await connectDb();
  if (!(await probeRedis())) throw new Error('The worker process needs Redis');
  await startWorkers();
  logger.info('workers started');
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
