import mongoose from 'mongoose';
import { env, isProd } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);
// Unknown fields throw in dev/test so mass-assignment bugs surface early (11_SECURITY.md §2).
mongoose.set('strict', isProd ? true : 'throw');

export async function connectDb(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, { autoIndex: !isProd, serverSelectionTimeoutMS: 10000 });
  logger.info({ db: conn.connection.name }, 'mongo connected');
  return conn;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export async function pingDb(): Promise<boolean> {
  try {
    const db = mongoose.connection.db;
    if (!db) return false;
    await db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
