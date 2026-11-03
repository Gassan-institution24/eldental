/**
 * Small RFC 4180 CSV reader/writer for the patient import (no dependency). Handles a UTF-8 BOM,
 * quoted fields with commas, quotes and line breaks, CRLF/LF, and `,` `;` or tab separators
 * (Excel in Arabic locales often saves with `;`).
 */

/** Excel writes a byte-order mark at the start of UTF-8 files. */
const BOM = String.fromCharCode(0xfeff);
const BOM_START = new RegExp(`^${BOM}`);

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.replace(BOM_START, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts] += 1;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as ',' | ';' | '\t') ?? ',';
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(BOM_START, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty lines (trailing newline, blank rows in the middle).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const needsQuotes = /[",;\t\r\n]/;

export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ','): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens Arabic text as UTF-8.
  return `${BOM}${rows.map((r) => r.map(cell).join(delimiter)).join('\r\n')}\r\n`;
}
