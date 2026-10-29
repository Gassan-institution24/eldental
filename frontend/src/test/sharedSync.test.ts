import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const pairs: [string, string][] = [
  ['backend/src/shared/validation/normalize.ts', 'frontend/src/shared/generated/validation/normalize.ts'],
  ['backend/src/shared/validation/fields.ts', 'frontend/src/shared/generated/validation/fields.ts'],
  ['backend/src/shared/validation/issues.ts', 'frontend/src/shared/generated/validation/issues.ts'],
  ['backend/src/shared/money.ts', 'frontend/src/shared/generated/money.ts'],
  ['backend/src/shared/errorCodes.ts', 'frontend/src/shared/generated/errorCodes.ts'],
  ['backend/src/core/rbac/registry.ts', 'frontend/src/shared/generated/rbac/registry.ts'],
  ['backend/src/core/rbac/platformRegistry.ts', 'frontend/src/shared/generated/rbac/platformRegistry.ts'],
  ['backend/src/core/rbac/rbac.types.ts', 'frontend/src/shared/generated/rbac/rbac.types.ts'],
];

/** Same Zod rules on client and server (16 §5.1): the copies must be byte-identical. */
describe('shared files are in sync with the backend', () => {
  for (const [be, fe] of pairs) {
    const bePath = resolve(root, be);
    it.skipIf(!existsSync(bePath))(fe, () => {
      expect(readFileSync(resolve(root, fe), 'utf8')).toBe(readFileSync(bePath, 'utf8'));
    });
  }
});
