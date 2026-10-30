import mongoose, { type ClientSession } from 'mongoose';
import { isProd } from '@/config/env';
import { logger } from '@/config/logger';

let replicaSet: boolean | null = null;

/** Transactions need a replica set. A standalone dev server falls back to plain writes. */
async function supportsTransactions(): Promise<boolean> {
  if (replicaSet !== null) return replicaSet;
  const db = mongoose.connection.db;
  if (!db) return true;
  const hello = (await db.admin().command({ hello: 1 })) as { setName?: string; msg?: string };
  replicaSet = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  if (!replicaSet) {
    if (isProd) throw new Error('MongoDB must be a replica set in production (transactions)');
    logger.warn('MongoDB is standalone: transactions are disabled (dev only). Run `docker compose up -d` for the rs0 replica set.');
  }
  return replicaSet;
}

type AfterCommit = () => void | Promise<void>;
const afterCommitHooks = new WeakMap<ClientSession, AfterCommit[]>();

/**
 * Runs `fn` in a Mongo transaction with automatic retry on transient errors.
 * Side effects (email, WhatsApp, JoFotara, events) go in `onCommit` and run only after commit.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) return fn(undefined as unknown as ClientSession);
  const session = await mongoose.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(async () => {
      afterCommitHooks.set(session, []);
      result = await fn(session);
    });
    const hooks = afterCommitHooks.get(session) ?? [];
    for (const h of hooks) await h();
    return result as T;
  } finally {
    afterCommitHooks.delete(session);
    await session.endSession();
  }
}

/** Queues `fn` to run after the transaction commits (or immediately without a session). */
export function onCommit(session: ClientSession | undefined | null, fn: AfterCommit): void {
  const hooks = session ? afterCommitHooks.get(session) : undefined;
  if (hooks) hooks.push(fn);
  else void fn();
}
