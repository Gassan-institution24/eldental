import type { RequestHandler } from 'express';

export const ROUTE_META = Symbol.for('eldental.routeMeta');
export type RouteMeta = { public?: boolean; permission?: string; kind?: string };
export type TaggedHandler = RequestHandler & { [ROUTE_META]?: RouteMeta };

export function tag(handler: RequestHandler, meta: RouteMeta): TaggedHandler {
  const h = handler as TaggedHandler;
  h[ROUTE_META] = meta;
  return h;
}

/** Marks a route as intentionally unauthenticated. Every route needs this or `authorize()`. */
export function publicRoute(): TaggedHandler {
  return tag((req, _res, next) => {
    req.routeMeta = { public: true };
    next();
  }, { public: true });
}
