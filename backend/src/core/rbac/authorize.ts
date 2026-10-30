import type { Request, RequestHandler } from 'express';
import { ApiError } from '../http/ApiError';
import { tag, type TaggedHandler } from '../http/routeMeta';
import type { AuthContext } from '../auth/auth.types';
import { PLATFORM_PERMISSIONS } from './platformRegistry';
import { PERMISSIONS } from './registry';
import { buildFieldPolicy, type FieldPolicy } from './resolve';
import type { Scope } from './rbac.types';

function isPlatformPerm(p: string) {
  return p.startsWith('platform.');
}

function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw ApiError.unauthenticated();
  return req.auth;
}

/** Decides scope for a clinic permission, or null when denied. Owner bypass (04 §1.6). */
export function scopeFor(auth: AuthContext, permission: string): Scope | null {
  if (isPlatformPerm(permission)) {
    if (auth.kind !== 'platform') return null;
    return auth.isRoot || auth.grants[permission] ? 'all' : null;
  }
  if (auth.kind !== 'staff' || !auth.clinicId) return null;
  if (auth.isOwner) return 'all';
  return auth.grants[permission]?.scope ?? null;
}

/**
 * `authorize('scheduling.appointment.book')` — deny by default (04 §1.2). Sets `req.auth.scope`
 * and `req.auth.permission`. Several keys = any of them (the widest scope wins).
 */
export function authorize(...permissions: string[]): TaggedHandler {
  for (const p of permissions) {
    if (!PERMISSIONS[p] && !PLATFORM_PERMISSIONS[p]) throw new Error(`authorize(): unknown permission ${p}`);
  }
  const handler: RequestHandler = (req, _res, next) => {
    try {
      const auth = requireAuth(req);
      let best: { p: string; s: Scope } | null = null;
      for (const p of permissions) {
        const s = scopeFor(auth, p);
        if (s && (!best || (best.s === 'own' && s === 'all'))) best = { p, s };
      }
      if (!best) {
        if (auth.kind === 'staff' && !auth.clinicId) throw ApiError.forbidden('CLINIC_SELECTION_REQUIRED', 'Select a clinic first');
        throw ApiError.forbidden('FORBIDDEN', 'Missing permission', { permission: permissions[0] });
      }
      auth.scope = best.s;
      auth.permission = best.p;
      req.routeMeta = { permission: best.p };
      next();
    } catch (err) {
      next(err);
    }
  };
  return tag(handler, { permission: permissions.join('|') });
}

/** Any signed-in user of the given kinds (own profile, notifications, /auth/me). */
authorize.self = function self(...kinds: AuthContext['kind'][]): TaggedHandler {
  return tag((req, _res, next) => {
    try {
      const auth = requireAuth(req);
      if (kinds.length && !kinds.includes(auth.kind)) throw ApiError.forbidden();
      next();
    } catch (err) {
      next(err);
    }
  }, { permission: 'self' });
};

/** Patient portal routes (04 §6.4): patient tokens only. */
export function requirePatient(): TaggedHandler {
  return tag((req, _res, next) => {
    try {
      const auth = requireAuth(req);
      if (auth.kind !== 'patient') throw ApiError.forbidden();
      next();
    } catch (err) {
      next(err);
    }
  }, { permission: 'patient' });
}

/** Field policy of the caller for a resource (owner/root see and write everything). */
export function fieldPolicyOf(auth: AuthContext, resource: string, actionPermission?: string): FieldPolicy {
  return buildFieldPolicy(auth.grants, resource, { bypass: auth.isOwner || auth.isRoot, actionPermission: actionPermission ?? auth.permission });
}

/** `own` scope filter: lists merge it, get/update/delete apply it together with `_id` (04 §6.3). */
export type ScopeRule = { own: (auth: AuthContext) => Record<string, unknown> };

export function scopeFilter(auth: AuthContext, rule: ScopeRule): Record<string, unknown> {
  return auth.scope === 'own' ? rule.own(auth) : {};
}

/** Combines a lookup filter with the scope filter without one overwriting the other (`_id`!). */
export function withScope<T extends Record<string, unknown>>(auth: AuthContext, rule: ScopeRule, filter: T): Record<string, unknown> {
  const scope = scopeFilter(auth, rule);
  return Object.keys(scope).length ? { $and: [filter, scope] } : filter;
}
