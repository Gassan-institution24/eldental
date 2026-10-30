import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';

const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');
const PREFIX = 'enc:v1:';

/** AES-256-GCM for secrets and sensitive PII at rest (11_SECURITY.md §7). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, data]).toString('base64')}`;
}

export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) throw new Error('not an encrypted value');
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Deterministic keyed hash so encrypted values (national ID) can still be looked up. */
export function searchHash(value: string): string {
  return createHmac('sha256', KEY).update(value.trim().toUpperCase()).digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomDigits(length: number): string {
  let out = '';
  while (out.length < length) {
    const n = randomBytes(1)[0] ?? 0;
    if (n < 250) out += String(n % 10);
  }
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
