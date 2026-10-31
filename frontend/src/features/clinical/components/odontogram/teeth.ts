/** FDI arches in chart order: the patient's right is on the viewer's left (07 §1). */
export const UPPER_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const UPPER_PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const LOWER_PRIMARY = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
export const WISDOM_TEETH = new Set([18, 28, 38, 48]);

export const isAnterior = (n: number) => n % 10 >= 1 && n % 10 <= 3;
export const isPrimary = (n: number) => Math.floor(n / 10) >= 5;
/** 1–4 for both dentitions (5→1, 6→2, 7→3, 8→4). */
export const quadrant = (n: number) => ((Math.floor(n / 10) - 1) % 4) + 1;
export const isUpper = (n: number) => quadrant(n) <= 2;
/** Quadrants drawn on the viewer's left, where mesial (toward the midline) is on the right. */
export const isViewerLeft = (n: number) => quadrant(n) === 1 || quadrant(n) === 4;

export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';
export function toothType(n: number): ToothType {
  const pos = n % 10;
  if (pos <= 2) return 'incisor';
  if (pos === 3) return 'canine';
  if (isPrimary(n)) return 'molar';
  return pos <= 5 ? 'premolar' : 'molar';
}

export type WheelPos = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** Which surface code sits where on a tooth's surface wheel. Buccal/facial faces away from the midline. */
export function surfaceAt(tooth: number, pos: WheelPos): string {
  const upper = isUpper(tooth);
  const ant = isAnterior(tooth);
  const facial = ant ? 'F' : 'B';
  switch (pos) {
    case 'center':
      return ant ? 'I' : 'O';
    case 'top':
      return upper ? facial : 'L';
    case 'bottom':
      return upper ? 'P' : facial;
    case 'left':
      return isViewerLeft(tooth) ? 'D' : 'M';
    case 'right':
      return isViewerLeft(tooth) ? 'M' : 'D';
  }
}
