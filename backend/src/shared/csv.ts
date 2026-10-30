/** RFC-4180 CSV with a UTF-8 BOM so Excel opens Arabic correctly. Formula injection is neutralised. */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))];
  return String.fromCharCode(0xfeff) + lines.join('\r\n');
}
