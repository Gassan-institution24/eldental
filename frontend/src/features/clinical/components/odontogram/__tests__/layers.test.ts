import { describe, expect, it } from 'vitest';
import type { EntryKind, ToothCondition, ToothState } from '../../../api';
import { MANAGED_LAYERS, toothArt } from '../layers';
import { surfaceAt } from '../teeth';

const ALL = new Set<EntryKind>(['existing', 'finding', 'planned', 'completed']);
const c = (code: string, kind: EntryKind, surfaces: string[] = []): ToothCondition => ({
  code,
  kind,
  surfaces,
  entryId: `${code}-${kind}`,
  notedAt: '',
});
const tooth = (conditions: ToothCondition[], status: ToothState['status'] = 'present') => ({
  status,
  conditions,
});

describe('toothArt', () => {
  it('draws a healthy tooth by default', () => {
    const a = toothArt(16, undefined, ALL);
    expect([...a.layers]).toEqual(['tooth-base', 'tooth-healthy-pulp', 'tooth-base-beauty']);
    expect(a.opacity).toBe(1);
  });

  it('maps surface conditions to per-face layers', () => {
    const a = toothArt(
      36,
      tooth([c('caries', 'finding', ['M', 'O']), c('filling', 'existing', ['B'])]),
      ALL,
    );
    expect(a.layers).toContain('caries-mesial');
    expect(a.layers).toContain('caries-occlusal');
    expect(a.layers).toContain('filling-composite-buccal');
    expect(a.layers).not.toContain('tooth-base-beauty');
  });

  it('replaces the natural tooth for missing, implant and pontic', () => {
    expect(toothArt(46, tooth([], 'missing'), ALL).layers).not.toContain('tooth-base');
    expect(toothArt(46, tooth([], 'implant'), ALL).layers).toContain('implant');
    const pontic = toothArt(46, tooth([c('bridge_pontic', 'existing')]), ALL);
    expect(pontic.pontic).toBe(true);
    expect(pontic.layers).not.toContain('tooth-base');
  });

  it('draws planned work as a marker, not as finished work', () => {
    const a = toothArt(16, tooth([c('crown', 'planned')]), ALL);
    expect(a.layers).toContain('crown-needed');
    expect(a.layers).not.toContain('zircon-crown');
  });

  it('respects the visible kinds', () => {
    const a = toothArt(16, tooth([c('crown', 'existing')]), new Set<EntryKind>(['finding']));
    expect(a.layers).not.toContain('zircon-crown');
  });

  it('swaps the tooth body for the matching broken variant', () => {
    const a = toothArt(11, tooth([c('fracture', 'finding', ['M', 'I'])]), ALL);
    expect(a.layers).toContain('tooth-broken-mesial-incisal');
    expect(a.layers).not.toContain('tooth-base');
  });

  it('badges what the artwork cannot draw', () => {
    expect(
      toothArt(37, tooth([c('mobility', 'finding'), c('custom_x', 'finding')]), ALL).badges,
    ).toEqual(['mobility', 'custom_x']);
  });

  it('only ever switches on managed layers', () => {
    const codes = [
      'caries',
      'filling',
      'inlay',
      'sealant',
      'fracture',
      'crown',
      'rct',
      'post',
      'veneer',
      'impacted',
      'abscess',
      'bridge_abutment',
      'bridge_pontic',
    ];
    for (const n of [11, 13, 14, 16, 36]) {
      for (const code of codes) {
        for (const l of toothArt(n, tooth([c(code, 'existing', ['M', 'D', 'O', 'B', 'L'])]), ALL)
          .layers)
          expect(MANAGED_LAYERS.has(l), `${code} on ${n} → ${l}`).toBe(true);
      }
    }
  });
});

describe('surfaceAt', () => {
  it('puts mesial toward the midline and buccal away from it', () => {
    expect(surfaceAt(16, 'right')).toBe('M');
    expect(surfaceAt(26, 'left')).toBe('M');
    expect(surfaceAt(16, 'top')).toBe('B');
    expect(surfaceAt(36, 'bottom')).toBe('B');
    expect(surfaceAt(11, 'center')).toBe('I');
    expect(surfaceAt(21, 'bottom')).toBe('P');
  });
});
