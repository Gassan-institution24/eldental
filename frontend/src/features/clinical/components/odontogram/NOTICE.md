# Tooth artwork: third-party notice

`artwork.ts` is **not** original ElDental work. It was taken from the Hakeemna project, which took it from:

|               |                                                                             |
| ------------- | --------------------------------------------------------------------------- |
| Source        | [React-Odontogram-Modul](https://github.com/ZoliQua/React-Odontogram-Modul) |
| Author        | Zoltán Dul ([@ZoliQua](https://github.com/ZoliQua))                         |
| Licence       | MIT. The full text is in `UPSTREAM-LICENSE`                                 |
| Upstream path | `src/assets/teeth-svgs/`                                                    |
| Commit        | `934a9119a640a6941429cbd9ea42e26220b7c55d` (2026-08-19)                     |

Each SVG keeps the author's attribution comment in its header. Do not strip it.

## Templates

| Template             | Archetype             | Used for                                          |
| -------------------- | --------------------- | ------------------------------------------------- |
| `11`                 | upper central incisor | incisors                                          |
| `13`                 | canine                | canines                                           |
| `14`                 | upper first premolar  | premolars                                         |
| `16`                 | upper first molar     | molars, including primary molars                  |
| `14_occl`, `16_occl` | occlusal views        | premolars and molars when the occlusal view is on |

The artwork is drawn crown up, roots down, with mesial on the right, the way quadrants 4 and 8 look on the chart.
`ToothArt.tsx` mirrors it for the other quadrants.

## Local modification

The SVGs are not byte-identical to upstream. Hakeemna pruned them once. Every clinical layer is authored off
(`data-active="0"`), and the `cysta`, `granuloma`, `abscess`, `mobility` and `inflammation` groups were removed.
**Do not replace this file with a fresh upstream copy.** If you do, a healthy tooth will show every
clinical state at once.

Some layers sit inside groups that are also authored off, for example `zircon-crown` inside `zircon` and
the fillings inside `fillings`. `ToothArt.tsx` switches those parent groups on while a child layer is
active. The Hakeemna renderer did not, so its crowns, veneers, inlays and fillings never showed.

The mapping from ElDental condition codes to layer ids lives in `layers.ts`.
