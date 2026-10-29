import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/** Connects to the in-memory replica set and wipes collections between tests. */
export function useTestDb(): void {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_TEST_URI as string);
    }
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes().catch(() => undefined)));
  });
  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) return;
    const collections = await db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
}
