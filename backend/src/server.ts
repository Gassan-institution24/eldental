import { createServer } from 'node:http';
import { env } from '@/config/env';
import { connectDb, disconnectDb } from '@/config/db';
import { logger } from '@/config/logger';
import { closeRedis, getRedis } from '@/config/redis';
import { flushRequestLogs } from '@/core/logging/requestLogger';
import { recordSystemError } from '@/core/logging/systemErrors.service';
import { startRuntime, stopRuntime } from '@/runtime';
import { createApp } from './app';

/** Boot order: env → db → redis → http → socket → jobs (02_ARCHITECTURE.md §2). */
async function main(): Promise<void> {
  await connectDb();
  getRedis();
  const app = createApp();
  const server = createServer(app);
  await startRuntime(server);
  server.listen(env.PORT, () => {
    logger.info(`${env.APP_NAME} API listening on ${env.API_PUBLIC_URL} (docs: /api/docs)`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await stopRuntime();
    await flushRequestLogs();
    await closeRedis();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
    void recordSystemError({ error: reason, source: 'http', route: 'unhandledRejection' });
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
