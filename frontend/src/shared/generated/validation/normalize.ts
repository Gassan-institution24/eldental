// SHARED FILE — the canonical copy lives in backend/src/shared/validation.
// The frontend copy is synced by `npm run sync:shared` (frontend) and checked by a test.

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Arabic-Indic and Persian digits to Western digits (16_UX_UI_AND_VALIDATION.md §5.5). */
export function toWesternDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) {
      out += String(a);
      continue;
    }
    const p = PERSIAN.indexOf(ch);
    out += p >= 0 ? String(p) : ch;
  }
  // Arabic decimal separator and thousands separator.
  return out.replace(/٫/g, '.').replace(/٬/g, ',');
}

/** Removes ASCII control characters except tab and newlines. */
export function stripControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function collapseSpaces(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/**
 * Normalised form used for search in both scripts (03_DATA_MODEL.md §1.1):
 * lowercase, Arabic diacritics/tatweel removed, أ/إ/آ→ا, ة→ه, ى→ي.
 */
export function toSearchName(input: string): string {
  return collapseSpaces(
    toWesternDigits(input)
      .toLowerCase()
      .replace(DIACRITICS, '')
      .replace(TATWEEL, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي'),
  );
}

/** Escapes user text for a literal, anchored regex. User input never becomes a raw regex. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
