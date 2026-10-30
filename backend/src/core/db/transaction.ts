import mongoose, { type ClientSession } from 'mongoose';

type AfterCommit = () => void | Promise<void>;
const afterCommitHooks = new WeakMap<ClientSession, AfterCommit[]>();

/**
 * Runs `fn` in a Mongo transaction with automatic retry on transient errors.
 * Side effects (email, WhatsApp, JoFotara, events) go in `onCommit` and run only after commit.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
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
