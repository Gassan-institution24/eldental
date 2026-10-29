import { AsyncLocalStorage } from 'node:async_hooks';
import type { Types } from 'mongoose';

export type RequestStore = {
  reqId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  userId?: Types.ObjectId | string;
  staffId?: Types.ObjectId | string;
  clinicId?: Types.ObjectId | string;
  impersonatorUserId?: Types.ObjectId | string;
  /** When true, tenant-scoped models do not require a clinicId (superadmin/platform/jobs only). */
  skipTenant?: boolean;
};

const storage = new AsyncLocalStorage<RequestStore>();

export const requestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestStore | undefined {
    return storage.getStore();
  },
  /** Mutates the current store (used after authentication fills in the user). */
  assign(patch: Partial<RequestStore>): void {
    const s = storage.getStore();
    if (s) Object.assign(s, patch);
  },
};
