import { memo, useEffect, useRef, useState } from 'react';
import { MANAGED_LAYERS, VIEW_LAYERS } from './layers';
import { isUpper, isViewerLeft, toothType } from './teeth';

export type ViewOptions = { occlusal: boolean; wisdom: boolean; bone: boolean; pulp: boolean };
export const DEFAULT_VIEW: ViewOptions = { occlusal: false, wisdom: true, bone: false, pulp: true };

type Artwork = Record<string, string>;
let artwork: Artwork | null = null;
let loading: Promise<Artwork> | null = null;

/** The artwork is ~400 KB of SVG markup, so it is its own chunk, loaded the first time a chart opens. */
export function useArtwork(): Artwork | null {
  const [art, setArt] = useState(artwork);
  useEffect(() => {
    if (art) return;
    loading ??= import('./artwork').then((m) => (artwork = m.TOOTH_ARTWORK));
    let live = true;
    void loading.then((a) => live && setArt(a));
    return () => {
      live = false;
    };
  }, [art]);
  return art;
}

const TEMPLATE = { incisor: '11', canine: '13', premolar: '14', molar: '16' } as const;
/** Upstream has occlusal drawings for posterior teeth only; anterior teeth keep the facial view. */
const OCCLUSAL = { premolar: '14_occl', molar: '16_occl' } as Partial<Record<string, string>>;

export const templateFor = (tooth: number, occlusal: boolean) =>
  (occlusal && OCCLUSAL[toothType(tooth)]) || TEMPLATE[toothType(tooth)];

/** Height ÷ width of each template, read from its viewBox. */
export function aspectOf(art: Artwork | null, id: string): number {
  const vb = art && /viewBox="([\d.\s-]+)"/.exec(art[id] ?? '');
  if (!vb?.[1]) return 1.75;
  const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
  return w && h ? h / w : 1.75;
}

/** Numbered or named sub-parts that must be switched on together with their layer. */
const partOf = (id: string) => new RegExp(`^${id}-(\\d+|outer|inner|occlusal|path|shape)$`);

type Props = {
  tooth: number;
  art: Artwork;
  layers: Set<string>;
  view: ViewOptions;
  width: number;
  opacity: number;
  pontic: boolean;
};

/**
 * One anatomical tooth from the React-Odontogram-Modul artwork (see NOTICE.md).
 * The markup is injected once; layer visibility is then written straight to the DOM on each change.
 */
function ToothArtImpl({ tooth, art, layers, view, width, opacity, pontic }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const forced = useRef<Element[]>([]);
  const id = templateFor(tooth, view.occlusal);
  const markup = art[id] ?? '';

  useEffect(() => {
    const svg = host.current?.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.display = 'block';

    // The pruned layers carry an inline `display: none` as well as `data-active="0"`; both must flip.
    const show = (el: Element, on: boolean) => {
      el.setAttribute('data-active', on ? '1' : '0');
      if (el instanceof SVGElement) el.style.display = on ? '' : 'none';
    };

    // Parent groups switched on last pass go back to their authored state first.
    forced.current.forEach((el) => show(el, false));
    forced.current = [];

    svg.querySelectorAll('[data-active]').forEach((node) => {
      if (!node.id || !MANAGED_LAYERS.has(node.id)) return;
      const on = layers.has(node.id);
      show(node, on);
      if (!on) return;
      const part = partOf(node.id);
      node.querySelectorAll('[data-active="0"]').forEach((child) => {
        if (part.test(child.id)) show(child, true);
      });
      // A layer inside a switched-off group (zircon-crown in zircon, fillings…) needs its parents on too.
      for (let p: Element | null = node.parentElement; p && p !== svg; p = p.parentElement) {
        if (p.getAttribute('data-active') === '0') {
          show(p, true);
          forced.current.push(p);
        }
      }
    });

    const set = (ids: string[], on: boolean) =>
      ids.forEach((x) => {
        const el = svg.querySelector(`[id="${x}"]`);
        if (el) show(el, on);
      });
    set(VIEW_LAYERS.bone, view.bone);
    if (!view.pulp) set(VIEW_LAYERS.pulp, false);
  }, [markup, layers, view.bone, view.pulp]);

  // Facial artwork is drawn like quadrant 1: roots up, mesial on the right. Mirror it for the others.
  const sx = isViewerLeft(tooth) ? 1 : -1;
  const sy = !isUpper(tooth) && !(view.occlusal && OCCLUSAL[toothType(tooth)]) ? -1 : 1;
  return (
    <div
      ref={host}
      aria-hidden
      style={{
        width,
        height: Math.round(width * aspectOf(art, id)),
        lineHeight: 0,
        opacity,
        transform: `scale(${sx}, ${sy})`,
        // Clip-path is in the artwork's own (untransformed) space, where roots are always at the top.
        clipPath: pontic ? 'inset(40% 0 0 0)' : undefined,
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export const ToothArt = memo(ToothArtImpl);
