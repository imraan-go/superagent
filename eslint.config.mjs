import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '.local/**', '**/test-results/**', '**/next-env.d.ts', 'packages/db/drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@ai-sdk/openai', message: 'Model calls go through the Vercel AI Gateway only.' },
            { name: '@ai-sdk/anthropic', message: 'Model calls go through the Vercel AI Gateway only.' },
            { name: 'openai', message: 'Model calls go through the Vercel AI Gateway only.' },
            { name: '@anthropic-ai/sdk', message: 'Model calls go through the Vercel AI Gateway only.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/workflows/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'crypto', 'http', 'https', 'net'], message: 'Workflow code must be deterministic: no Node I/O.' },
            { group: ['@superagent/*', '!@superagent/contracts', '!@superagent/contracts/workflow'], message: 'Workflows may only depend on contracts.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'No I/O in workflows; use an Activity.' }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Non-deterministic; Temporal patches it but prefer uuid4() from the workflow API.' },
      ],
    },
  },
);
