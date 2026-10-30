import { ApiError } from '../http/ApiError';
import { fieldsOf } from './registry';
import type { MaskKind } from './rbac.types';
import type { FieldPolicy } from './resolve';

const DOT = '•';

/** Server-side masking (04 §4.2): the raw value never leaves the API. */
export function maskValue(kind: MaskKind | undefined, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ('e164' in obj) return { masked: true, e164: maskValue('phone', obj.e164) };
    return { masked: true };
  }
  const s = String(value);
  switch (kind ?? 'full') {
    case 'phone': {
      const digits = s.replace(/^\+962/, '0');
      return digits.length <= 5 ? DOT.repeat(digits.length) : `${digits.slice(0, 3)}${DOT.repeat(digits.length - 5)}${digits.slice(-2)}`;
    }
    case 'email': {
      const [user = '', domain = ''] = s.split('@');
      const [host = '', ...tld] = domain.split('.');
      return `${user.slice(0, 1)}${DOT.repeat(3)}@${host.slice(0, 1)}${DOT.repeat(3)}${tld.length ? `.${tld.join('.')}` : ''}`;
    }
    case 'tail4':
      return `${DOT.repeat(4)} ${s.slice(-4)}`;
    default:
      return DOT.repeat(6);
  }
}

function pathsOf(resource: string, field: string): readonly string[] {
  return fieldsOf(resource)?.[field]?.paths ?? [field];
}

function deletePath(obj: unknown, path: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  const [head, ...rest] = path;
  if (!head) return;
  if (Array.isArray(obj)) {
    for (const item of obj) deletePath(item, path);
    return;
  }
  const rec = obj as Record<string, unknown>;
  if (rest.length === 0) delete rec[head];
  else deletePath(rec[head], rest);
}

function mapPath(obj: unknown, path: string[], fn: (v: unknown) => unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const [head, ...rest] = path;
  if (!head) return;
  if (Array.isArray(obj)) {
    for (const item of obj) mapPath(item, path, fn);
    return;
  }
  const rec = obj as Record<string, unknown>;
  if (!(head in rec)) return;
  if (rest.length === 0) rec[head] = fn(rec[head]);
  else mapPath(rec[head], rest, fn);
}

function hasPath(obj: unknown, path: string[]): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const [head, ...rest] = path;
  if (!head) return false;
  if (Array.isArray(obj)) return obj.some((item) => hasPath(item, path));
  const rec = obj as Record<string, unknown>;
  if (!(head in rec)) return false;
  return rest.length === 0 ? true : hasPath(rec[head], rest);
}

/** Fields that must not leave the DB (neither visible nor masked). */
export function hiddenFields(policy: FieldPolicy): string[] {
  return Object.keys(fieldsOf(policy.resource) ?? {}).filter((f) => !policy.visible.has(f) && !policy.masked.has(f));
}

/**
 * Mongo exclusion projection for hidden fields (04 §4.3 "hidden data never leaves the DB").
 * `dbPaths` maps API field paths to storage paths when they differ (e.g. nationalId → nationalIdEnc).
 */
export function projectionFor(policy: FieldPolicy, dbPaths: Record<string, readonly string[]> = {}): Record<string, 0> {
  const out: Record<string, 0> = {};
  for (const f of hiddenFields(policy)) {
    for (const p of dbPaths[f] ?? pathsOf(policy.resource, f)) out[p] = 0;
  }
  // A parent excluded together with a child path is a Mongo error; keep only the shortest.
  for (const p of Object.keys(out)) {
    if (Object.keys(out).some((q) => q !== p && p.startsWith(`${q}.`))) delete out[p];
  }
  return out;
}

/** Removes hidden fields and masks masked ones on an API-shaped object (mutates + returns). */
export function applyFieldPolicy<T>(dto: T, policy: FieldPolicy): T {
  const registry = fieldsOf(policy.resource) ?? {};
  for (const [f, def] of Object.entries(registry)) {
    const paths = pathsOf(policy.resource, f);
    if (policy.masked.has(f)) {
      for (const p of paths) mapPath(dto, p.split('.'), (v) => maskValue(def.mask, v));
    } else if (!policy.visible.has(f)) {
      for (const p of paths) deletePath(dto, p.split('.'));
    }
  }
  return dto;
}

/** Writes to non-writable fields are rejected, not silently dropped: 403 FIELD_FORBIDDEN. */
export function assertWritable(body: unknown, policy: FieldPolicy): void {
  const forbidden: string[] = [];
  for (const f of Object.keys(fieldsOf(policy.resource) ?? {})) {
    if (policy.writable.has(f)) continue;
    const touched = [f, ...pathsOf(policy.resource, f)].some((p) => hasPath(body, p.split('.')));
    if (touched) forbidden.push(f);
  }
  if (forbidden.length) {
    throw new ApiError(403, 'FIELD_FORBIDDEN', 'Some fields are not writable for you', { fields: forbidden });
  }
}

/** No inference: sort, search and filters on hidden or masked fields → 422 FIELD_NOT_ALLOWED. */
export function assertQueryable(fields: readonly (string | undefined)[], policy: FieldPolicy): void {
  const bad = fields.filter((f): f is string => Boolean(f) && Boolean(fieldsOf(policy.resource)?.[f as string]) && !policy.visible.has(f as string));
  if (bad.length) {
    throw new ApiError(422, 'FIELD_NOT_ALLOWED', 'Cannot sort or search on these fields', { fields: bad.map((f) => ({ path: f, code: 'field_forbidden' })) });
  }
}

/** Sort keys from `-name,phone` → field keys for assertQueryable. */
export function sortFields(sort: string | undefined): string[] {
  return (sort ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^-/, '').split('.')[0] ?? '')
    .filter(Boolean);
}
