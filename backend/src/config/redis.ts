import { Redis } from 'ioredis';
import { env, isProd, isTest } from './env';
import { logger } from './logger';

let client: Redis | null = null;

/** `family: 0` resolves IPv4 and IPv6 (Railway's private network may answer IPv6 only). */
const BASE = { family: 0 } as const;

/** The URL for log lines, without the password (15 §2: no secrets in logs). */
export function safeRedisUrl(url: string = env.REDIS_URL): string {
  return url.replace(/\/\/([^@/]*)@/, '//***@');
}

/** null = not probed yet. In dev, a missing Redis switches to in-memory fallbacks. */
let available: boolean | null = isTest ? false : null;

/**
 * Probes Redis once at boot. Production requires it; in development the API keeps working
 * without it (memory rate limits + permission cache, inline jobs, single-instance sockets).
 */
export async function probeRedis(): Promise<boolean> {
  if (isTest) return false;
  // Production retries for a while: on a fresh container the private DNS can lag behind the boot.
  const attempts = isProd ? 5 : 1;
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    let probe: Redis | null = null;
    try {
      probe = new Redis(env.REDIS_URL, { ...BASE, lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: isProd ? 5000 : 1500, retryStrategy: () => null });
      probe.on('error', () => undefined);
      await probe.connect();
      await probe.ping();
      available = true;
      return true;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
    } finally {
      probe?.disconnect();
    }
  }
  available = false;
  const reason = lastError instanceof Error ? lastError.message.replace(env.REDIS_URL, safeRedisUrl()) : 'unknown error';
  if (isProd) throw new Error(`Redis is required in production (${safeRedisUrl()}): ${reason}`);
  logger.warn(`Redis not reachable at ${safeRedisUrl()} — using in-memory fallbacks (dev only). Start it with: docker compose up -d redis`);
  return false;
}

export function isRedisAvailable(): boolean {
  return available === true;
}

/** Shared connection, or null when Redis is unavailable (callers fall back to memory). */
export function getRedis(): Redis | null {
  if (!available) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, { ...BASE, maxRetriesPerRequest: null });
    // If Redis drops after boot: warn once, use the in-memory fallbacks, recover when it's back.
    client.on('error', (err) => {
      if (available === false) return;
      available = false;
      if (isProd) logger.error({ err }, 'redis error');
      else logger.warn(`Redis connection lost (${safeRedisUrl()}) — using in-memory fallbacks until it comes back`);
    });
    client.on('ready', () => {
      if (available === false) logger.info('Redis connection restored');
      available = true;
    });
  }
  return client;
}

/** A dedicated connection (BullMQ workers and the socket adapter need their own). */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { ...BASE, maxRetriesPerRequest: null });
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
