// Copies the canonical shared files from the backend into src/shared/generated so the
// client uses the exact same validation rules, money helpers and permission registry.
// The copies are committed (the frontend can build alone); a test checks they are in sync.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, '../../backend/src');
const target = resolve(here, '../src/shared/generated');

export const SHARED_FILES = [
  ['shared/validation/normalize.ts', 'validation/normalize.ts'],
  ['shared/validation/fields.ts', 'validation/fields.ts'],
  ['shared/validation/issues.ts', 'validation/issues.ts'],
  ['shared/money.ts', 'money.ts'],
  ['core/rbac/registry.ts', 'rbac/registry.ts'],
  ['core/rbac/platformRegistry.ts', 'rbac/platformRegistry.ts'],
  ['core/rbac/rbac.types.ts', 'rbac/rbac.types.ts'],
  ['shared/errorCodes.ts', 'errorCodes.ts'],
  ['shared/dental/teeth.ts', 'dental/teeth.ts'],
];

if (!existsSync(backendSrc)) {
  console.log('[sync-shared] backend not found, keeping committed copies');
  process.exit(0);
}

let changed = 0;
for (const [from, to] of SHARED_FILES) {
  const src = resolve(backendSrc, from);
  if (!existsSync(src)) continue;
  const dest = resolve(target, to);
  const content = readFileSync(src, 'utf8');
  const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (current === content) continue;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  changed += 1;
}
if (changed) console.log(`[sync-shared] updated ${changed} file(s)`);
