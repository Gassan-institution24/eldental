import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'uploads'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Import env from @/config/env instead.' },
      ],
    },
  },
  {
    files: ['src/config/env.ts', 'test/**/*.ts', 'vitest.config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
