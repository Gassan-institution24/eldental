import type { Server } from 'node:http';

type Hook = { start: (server?: Server) => Promise<void> | void; stop: () => Promise<void> | void };
const hooks: Hook[] = [];

/** Socket.IO, BullMQ workers and repeatable jobs register here so server.ts stays small. */
export function registerRuntime(hook: Hook): void {
  hooks.push(hook);
}

export async function startRuntime(server?: Server): Promise<void> {
  for (const h of hooks) await h.start(server);
}

export async function stopRuntime(): Promise<void> {
  for (const h of [...hooks].reverse()) await h.stop();
}
