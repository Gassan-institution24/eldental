import { Redis } from 'ioredis';
import { env, isTest } from './env';
import { logger } from './logger';

let client: Redis | null = null;

/**
 * Shared Redis connection. Tests run without Redis: callers must handle `null`
 * (permission cache and rate limiter fall back to memory, queues run in-memory).
 */
export function getRedis(): Redis | null {
  if (isTest) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
    client.on('error', (err) => logger.error({ err }, 'redis error'));
    client.on('connect', () => logger.info('redis connected'));
  }
  return client;
}

/** A dedicated connection (BullMQ workers and the socket adapter need their own). */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function pingRedis(): Promise<boolean> {
  const r = getRedis();
  if (!r) return isTest;
  try {
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
