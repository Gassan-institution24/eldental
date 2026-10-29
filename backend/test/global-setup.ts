import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | undefined;

/** One in-memory replica set for the whole run (transactions need a replica set). */
export async function setup(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGO_TEST_URI = replSet.getUri('eldental_test');
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
