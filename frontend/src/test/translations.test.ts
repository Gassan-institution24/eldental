import { describe, expect, it } from 'vitest';
import { ERROR_CODES, VALIDATION_CODES } from '@/shared/generated/errorCodes';
import { PERMISSION_KEYS } from '@/shared/generated/rbac/registry';
import { PLATFORM_PERMISSION_KEYS } from '@/shared/generated/rbac/platformRegistry';
import { resources } from '@/i18n';

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

/** Plural variants (`x_one`, `x_other`…) count as one key `x`, but only when `x_other` exists. */
function keysOf(lng: string, ns: string): Set<string> {
  const raw = flatten(resources[lng]?.[ns] ?? {});
  const all = new Set(raw);
  return new Set(raw.map((k) => (PLURAL.test(k) && all.has(k.replace(PLURAL, '_other')) ? k.replace(PLURAL, '') : k)));
}

describe('translations (16_UX_UI_AND_VALIDATION.md §5.7)', () => {
  const namespaces = new Set([...Object.keys(resources.ar ?? {}), ...Object.keys(resources.en ?? {})]);

  it('both languages have the same namespaces', () => {
    expect(Object.keys(resources.ar ?? {}).sort()).toEqual(Object.keys(resources.en ?? {}).sort());
  });

  for (const ns of namespaces) {
    it(`namespace "${ns}" has the same keys in ar and en`, () => {
      const ar = keysOf('ar', ns);
      const en = keysOf('en', ns);
      const missingInAr = [...en].filter((k) => !ar.has(k));
      const missingInEn = [...ar].filter((k) => !en.has(k));
      expect({ missingInAr, missingInEn }).toEqual({ missingInAr: [], missingInEn: [] });
    });
  }

  it('no translation is empty', () => {
    for (const lng of ['ar', 'en']) {
      for (const ns of namespaces) {
        const empty = flatten(resources[lng]?.[ns] ?? {}).filter((k) => {
          const v = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], resources[lng]?.[ns]);
          return typeof v === 'string' && v.trim() === '';
        });
        expect(empty, `${lng}/${ns}`).toEqual([]);
      }
    }
  });

  it('every backend error code has ar + en text', () => {
    for (const lng of ['ar', 'en']) {
      const keys = keysOf(lng, 'errors');
      expect(ERROR_CODES.filter((c) => !keys.has(c)), lng).toEqual([]);
    }
  });

  it('every validation code has ar + en text', () => {
    for (const lng of ['ar', 'en']) {
      const keys = keysOf(lng, 'validation');
      expect(VALIDATION_CODES.filter((c) => !keys.has(c)), lng).toEqual([]);
    }
  });

  it('every permission has a label in both languages', () => {
    for (const lng of ['ar', 'en']) {
      const keys = keysOf(lng, 'perm');
      const missing = [...PERMISSION_KEYS, ...PLATFORM_PERMISSION_KEYS].filter((p) => !keys.has(p));
      expect(missing, lng).toEqual([]);
    }
  });
});
