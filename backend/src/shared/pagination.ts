import { z } from 'zod';
import { ApiError } from '@/core/http/ApiError';

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100, { message: 'too_big' }).default(25),
  sort: z.string().max(200).optional(),
  q: z.string().trim().max(100, { message: 'too_long' }).optional(),
};

export type PageQuery = { page: number; limit: number; sort?: string; q?: string };

/** Turns `-createdAt,name` into a Mongo sort, allowing only whitelisted fields. */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: Record<string, 1 | -1> = { createdAt: -1 },
): Record<string, 1 | -1> {
  if (!sort) return fallback;
  const out: Record<string, 1 | -1> = {};
  for (const raw of sort
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const desc = raw.startsWith('-');
    const key = desc ? raw.slice(1) : raw;
    if (!allowed.includes(key)) {
      throw ApiError.validation([
        { path: 'query.sort', code: 'invalid_option', params: { field: key } },
      ]);
    }
    out[key] = desc ? -1 : 1;
  }
  return Object.keys(out).length ? out : fallback;
}

export function skipOf(q: { page: number; limit: number }): number {
  return (q.page - 1) * q.limit;
}
