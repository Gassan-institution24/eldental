import { Redis } from 'ioredis';
import { env, isProd, isTest } from './env';
import { logger } from './logger';

let client: Redis | null = null;
/** null = not probed yet. In dev, a missing Redis switches to in-memory fallbacks. */
let available: boolean | null = isTest ? false : null;

/**
 * Probes Redis once at boot. Production requires it; in development the API keeps working
 * without it (memory rate limits + permission cache, inline jobs, single-instance sockets).
 */
export async function probeRedis(): Promise<boolean> {
  if (isTest) return false;
  const probe = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1500, retryStrategy: () => null });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    await probe.ping();
    available = true;
  } catch {
    available = false;
    if (isProd) throw new Error(`Redis is required in production (${env.REDIS_URL})`);
    logger.warn(`Redis not reachable at ${env.REDIS_URL} — using in-memory fallbacks (dev only). Start it with: docker compose up -d redis`);
  } finally {
    probe.disconnect();
  }
  return available;
}

export function isRedisAvailable(): boolean {
  return available === true;
}

/** Shared connection, or null when Redis is unavailable (callers fall back to memory). */
export function getRedis(): Redis | null {
  if (!available) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    client.on('error', (err) => logger.error({ err }, 'redis error'));
  }
  return client;
}

/** A dedicated connection (BullMQ workers and the socket adapter need their own). */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function pingRedis(): Promise<boolean> {
  const r = getRedis();
  if (!r) return !isProd;
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
