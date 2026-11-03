import { describe, expect, it } from 'vitest';
import { safeRedisUrl } from './redis';

describe('safeRedisUrl', () => {
  it('hides the credentials and keeps the host', () => {
    expect(safeRedisUrl('redis://default:s3cret@redis.railway.internal:6379')).toBe('redis://***@redis.railway.internal:6379');
    expect(safeRedisUrl('rediss://:pw@host:6380/0')).toBe('rediss://***@host:6380/0');
    expect(safeRedisUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379');
  });
});
