import type { EntryKind, ToothState } from '../../api';
import { isAnterior } from './teeth';

/** ElDental surface code → the artwork's face name. */
const FACE: Record<string, string> = {
  M: 'mesial',
  D: 'distal',
  O: 'occlusal',
  I: 'occlusal',
  B: 'buccal',
  F: 'buccal',
  L: 'lingual',
  P: 'lingual',
};

/** Whole-tooth conditions → artwork layers. Anterior crowns use the ceramic (e.max) drawing. */
const WHOLE: Record<string, (tooth: number) => string[]> = {
  crown: (n) => [isAnterior(n) ? 'emax-crown' : 'zircon-crown'],
  rct: () => ['endo-filling'],
  post: () => ['endo-filling', 'endo-glass-pin'],
  veneer: () => ['emax-veneer'],
  bridge_abutment: () => ['zircon-crown', 'zircon-bridge-connector'],
  bridge_pontic: () => ['zircon-crown', 'zircon-bridge-connector'],
  impacted: () => ['tooth-under-gum'],
  abscess: () => ['tooth-inflam-pulp'],
  implant: () => ['implant', 'implant-base'],
  missing: () => ['no-tooth-after-extraction'],
};

/** Planned whole-tooth work shows upstream's "crown needed" marker instead of the finished crown. */
const PLANNED_CROWN = new Set(['crown', 'veneer', 'bridge_abutment', 'bridge_pontic']);

/** Conditions whose drawing replaces the natural crown, so the healthy tooth is switched off. */
const REPLACES_TOOTH = new Set(['missing', 'implant', 'impacted', 'unerupted', 'bridge_pontic']);

/** Conditions the artwork cannot draw: they show as a coloured badge on the tile instead. */
const BADGE_ONLY = new Set(['mobility', 'abscess']);

function brokenLayer(surfaces: string[]): string {
  const m = surfaces.includes('M');
  const d = surfaces.includes('D');
  const i = surfaces.includes('I') || surfaces.includes('O');
  const parts = [m && 'mesial', d && 'distal', (i || (!m && !d)) && 'incisal'].filter(Boolean);
  return `tooth-broken-${parts.join('-')}`;
}

export type ToothArtState = {
  layers: Set<string>;
  /** Drawing opacity: missing teeth fade out, unerupted/impacted ones partly. */
  opacity: number;
  /** A pontic floats without roots. */
  pontic: boolean;
  /** Codes shown as badges (no artwork, or a custom clinic condition). */
  badges: string[];
};

/**
 * Turns a tooth's chart snapshot into the artwork layers to switch on.
 * Only conditions whose kind is visible are drawn; planned work is drawn as markers, never as finished work.
 */
export function toothArt(
  tooth: number,
  state: ToothState | undefined,
  visible: Set<EntryKind>,
): ToothArtState {
  const layers = new Set<string>();
  const badges: string[] = [];
  const conds = (state?.conditions ?? []).filter((c) => visible.has(c.kind));
  const done = conds.filter((c) => c.kind !== 'planned');
  const status = state?.status ?? 'present';
  const codes = new Set(done.map((c) => c.code));
  if (status !== 'present') codes.add(status);

  const gone = [...codes].some((c) => REPLACES_TOOTH.has(c));
  if (!gone) {
    layers.add('tooth-base');
    if (!codes.has('abscess')) layers.add('tooth-healthy-pulp');
    if (done.length === 0) layers.add('tooth-base-beauty');
  }
  if (status === 'unerupted') layers.add('tooth-under-gum');

  for (const code of codes) {
    WHOLE[code]?.(tooth).forEach((l) => layers.add(l));
    if (BADGE_ONLY.has(code)) badges.push(code);
  }

  for (const c of done) {
    const faces = (c.surfaces ?? []).map((s) => FACE[s]).filter((f): f is string => Boolean(f));
    switch (c.code) {
      case 'caries':
        faces.forEach((f) => layers.add(`caries-${f}`));
        break;
      case 'filling':
        faces.forEach((f) => layers.add(`filling-composite-${f}`));
        break;
      case 'inlay':
        layers.add('emax-inlay');
        break;
      case 'sealant':
        layers.add('fissure-sealing');
        break;
      case 'fracture':
        // A broken variant is a whole alternative tooth body, drawn instead of the intact one.
        if (layers.delete('tooth-base')) layers.add(brokenLayer(c.surfaces ?? []));
        layers.delete('tooth-base-beauty');
        break;
      default:
        if (!WHOLE[c.code] && !BADGE_ONLY.has(c.code)) badges.push(c.code);
    }
  }

  for (const c of conds.filter((x) => x.kind === 'planned')) {
    if (PLANNED_CROWN.has(c.code)) layers.add('crown-needed');
    if (c.code === 'missing') layers.add('extraction-plan');
  }

  let opacity = 1;
  if (status === 'missing') opacity = 0.8;
  else if (status === 'unerupted' || codes.has('impacted')) opacity = 0.6;

  return { layers, opacity, pontic: codes.has('bridge_pontic'), badges: [...new Set(badges)] };
}

/** Every layer `toothArt` can switch on. The renderer writes all of them on each pass, so clearing one removes it. */
export const MANAGED_LAYERS = new Set<string>([
  'tooth-base',
  'tooth-healthy-pulp',
  'tooth-base-beauty',
  'tooth-under-gum',
  'emax-inlay',
  'fissure-sealing',
  'crown-needed',
  'extraction-plan',
  ...Object.values(WHOLE).flatMap((f) => [...f(11), ...f(16)]),
  ...['mesial', 'distal', 'occlusal', 'buccal', 'lingual'].flatMap((f) => [
    `caries-${f}`,
    `filling-composite-${f}`,
  ]),
  ...['M', 'D', 'I', 'MD', 'MI', 'DI', 'MDI'].map((s) => brokenLayer(s.split(''))),
]);

/** Layers owned by the view toggles rather than patient data. Applied after the data pass, so they win. */
export const VIEW_LAYERS = {
  bone: ['base', 'bone-base', 'gum-base'],
  pulp: ['tooth-healthy-pulp', 'tooth-inflam-pulp'],
};
