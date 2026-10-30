import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { ROUTE_META, type TaggedHandler } from '@/core/http/routeMeta';
import { getApp } from './helpers';

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: TaggedHandler }[] }; name?: string; handle?: { stack?: Layer[] } };

/** Every route lists `authorize(...)` or `public()` (04 §1.2, 11 §2). Fails the build otherwise. */
export function collectRoutes(app: Express): { method: string; path: string; meta: unknown }[] {
  const out: { method: string; path: string; meta: unknown }[] = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const meta = layer.route.stack.map((s) => s.handle[ROUTE_META]).find(Boolean);
        for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: layer.route.path, meta });
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack);
  return out;
}

describe('route meta', () => {
  it('every route declares authorize() or public()', () => {
    const routes = collectRoutes(getApp());
    expect(routes.length).toBeGreaterThan(20);
    const missing = routes.filter((r) => !r.meta && !r.path.startsWith('/api/docs'));
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('no unauthenticated destructive route exists (11 §11)', () => {
    const routes = collectRoutes(getApp());
    const publicDeletes = routes.filter((r) => r.method === 'DELETE' && (r.meta as { public?: boolean } | undefined)?.public);
    expect(publicDeletes).toEqual([]);
  });
});
