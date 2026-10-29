import type { Response } from 'express';

export type PageMeta = { page: number; limit: number; total: number; pages: number };
export type CursorMeta = { nextCursor: string | null; limit: number };

export function ok<T>(res: Response, data: T, meta?: PageMeta | CursorMeta | Record<string, unknown>) {
  return res.status(200).json(meta ? { data, meta } : { data });
}

export function created<T>(res: Response, data: T, location?: string) {
  if (location) res.location(location);
  return res.status(201).json({ data });
}

export function noContent(res: Response) {
  return res.status(204).end();
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}
