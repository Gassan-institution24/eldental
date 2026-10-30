import type { EffectiveGrant } from '../auth/auth.types';
import { actionOf, fieldsOf, PERMISSIONS, resourceOf, WRITE_ACTIONS } from './registry';
import { FIELD_ACCESS_ORDER, isRevoked, type FieldAccess, type Grant, type Override } from './rbac.types';

/** Field map for one grant: registry defaults overlaid with the grant's own entries. */
export function resolveFields(grant: Pick<Grant, 'permission' | 'fields'>): Record<string, FieldAccess> {
  const registry = fieldsOf(resourceOf(grant.permission));
  if (!registry) return {};
  const out: Record<string, FieldAccess> = {};
  for (const [f, def] of Object.entries(registry)) {
    let level = grant.fields?.[f] ?? def.default;
    // A field that cannot be masked falls back to hidden (never leak by accident).
    if (level === 'masked' && !def.maskable) level = 'hidden';
    out[f] = level;
  }
  return out;
}

function maxAccess(a: FieldAccess, b: FieldAccess): FieldAccess {
  return FIELD_ACCESS_ORDER[a] >= FIELD_ACCESS_ORDER[b] ? a : b;
}

/**
 * Union of roles, then per-staff overrides (04 §1.5, §4.4):
 * - scope `all` beats `own`; fields `write > read > masked > hidden`;
 * - an override replaces the merged result for that key; `revoked` removes it.
 * Pure function — the core of permission + field resolution.
 */
export function resolveEffectiveGrants(roleGrants: readonly Grant[][], overrides: readonly Override[] = []): Record<string, EffectiveGrant> {
  const out: Record<string, EffectiveGrant> = {};
  for (const grants of roleGrants) {
    for (const g of grants) {
      const def = PERMISSIONS[g.permission];
      if (!def) continue; // removed permissions in old role documents are ignored
      const scope = def.scopes.includes(g.scope) ? g.scope : (def.scopes[0] ?? 'all');
      const fields = resolveFields(g);
      const current = out[g.permission];
      if (!current) {
        out[g.permission] = { scope, fields };
        continue;
      }
      current.scope = current.scope === 'all' || scope === 'all' ? 'all' : 'own';
      for (const [f, level] of Object.entries(fields)) current.fields[f] = maxAccess(current.fields[f] ?? 'hidden', level);
    }
  }
  for (const o of overrides) {
    if (isRevoked(o)) {
      delete out[o.permission];
      continue;
    }
    const def = PERMISSIONS[o.permission];
    if (!def) continue;
    out[o.permission] = { scope: def.scopes.includes(o.scope) ? o.scope : (def.scopes[0] ?? 'all'), fields: resolveFields(o) };
  }
  return out;
}

export type FieldPolicy = {
  resource: string;
  visible: Set<string>;
  masked: Set<string>;
  writable: Set<string>;
  access: (field: string) => FieldAccess;
};

/**
 * `fieldPolicy(auth, resource)` (04 §4.3). Visibility comes from the resource's `read` grant
 * (or, without one, the widest grant on the resource). Writability comes from the exact write
 * permission the route authorized, so "create: write nationalId" never unmasks it on reads.
 */
export function buildFieldPolicy(
  grants: Record<string, EffectiveGrant>,
  resource: string,
  opts: { bypass?: boolean; actionPermission?: string } = {},
): FieldPolicy {
  const registry = fieldsOf(resource) ?? {};
  const readLevels: Record<string, FieldAccess> = {};
  const writeLevels: Record<string, FieldAccess> = {};
  if (opts.bypass) {
    for (const f of Object.keys(registry)) {
      readLevels[f] = 'write';
      writeLevels[f] = 'write';
    }
  } else {
    const readGrant = grants[`${resource}.read`];
    const sources = readGrant ? [readGrant] : Object.entries(grants).filter(([p]) => resourceOf(p) === resource).map(([, g]) => g);
    for (const g of sources) for (const [f, level] of Object.entries(g.fields)) readLevels[f] = maxAccess(readLevels[f] ?? 'hidden', level);
    const action = opts.actionPermission;
    if (action && resourceOf(action) === resource && WRITE_ACTIONS.has(actionOf(action))) {
      for (const [f, level] of Object.entries(grants[action]?.fields ?? {})) writeLevels[f] = level;
    }
  }
  const visible = new Set<string>();
  const masked = new Set<string>();
  const writable = new Set<string>();
  for (const f of Object.keys(registry)) {
    const level = readLevels[f] ?? 'hidden';
    if (level === 'masked') masked.add(f);
    if (level === 'read' || level === 'write') visible.add(f);
    if (writeLevels[f] === 'write') writable.add(f);
  }
  return {
    resource,
    visible,
    masked,
    writable,
    access: (f) => (writable.has(f) ? 'write' : visible.has(f) ? 'read' : masked.has(f) ? 'masked' : 'hidden'),
  };
}

/**
 * Escalation rule (04 §8.2): a granter can give only permissions they hold, with field rules no
 * wider than their own. Returns the offending permission keys.
 */
export function escalationViolations(
  granter: Record<string, { fields?: Record<string, FieldAccess>; clinicIds?: string[] }> | 'root',
  requested: readonly Grant[],
): string[] {
  if (granter === 'root') return [];
  const bad: string[] = [];
  for (const r of requested) {
    const mine = granter[r.permission];
    if (!mine) {
      bad.push(r.permission);
      continue;
    }
    for (const [f, level] of Object.entries(r.fields ?? {})) {
      const myLevel = mine.fields?.[f] ?? 'write';
      if (FIELD_ACCESS_ORDER[level] > FIELD_ACCESS_ORDER[myLevel]) {
        bad.push(`${r.permission}:${f}`);
      }
    }
    if (mine.clinicIds && mine.clinicIds.length > 0) {
      const wanted = r.clinicIds ?? [];
      if (wanted.length === 0 || wanted.some((c) => !mine.clinicIds?.includes(c))) bad.push(`${r.permission}:clinicIds`);
    }
  }
  return bad;
}
