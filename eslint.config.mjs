import { readFileSync, readdirSync } from 'node:fs';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Model calls go through the Vercel AI Gateway only. Repeated in every block that sets
// no-restricted-imports, because a later block replaces the rule's options instead of merging them.
const gatewayOnly = ['@ai-sdk/openai', '@ai-sdk/anthropic', 'openai', '@anthropic-ai/sdk'].map((name) => ({
  name,
  message: 'Model calls go through the Vercel AI Gateway only.',
}));

// Package boundaries: source code may import only the @superagent/* packages its package.json
// declares. Adding a cross-package dependency is a deliberate, reviewable package.json change;
// see docs/architecture.md for the layering.
const workspaceDirs = ['apps', 'packages'].flatMap((root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${root}/${d.name}`),
);
const boundaryBlocks = workspaceDirs.flatMap((dir) => {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  } catch {
    return [];
  }
  const allowed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, [pkg.name]: '' }).filter((d) =>
    d.startsWith('@superagent/'),
  );
  return [
    {
      files: [`${dir}/src/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: gatewayOnly,
            patterns: [
              {
                group: ['@superagent/*', ...allowed.flatMap((d) => [`!${d}`, `!${d}/**`])],
                message: `${pkg.name} does not declare this package. Add it to ${dir}/package.json only if the dependency belongs in the architecture (docs/architecture.md).`,
              },
            ],
          },
        ],
      },
    },
  ];
});

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '.local/**', '**/test-results/**', '**/next-env.d.ts', 'packages/db/migrations/**'],
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
        { paths: gatewayOnly },
      ],
    },
  },
  {
    // The web app: React hook rules and Next.js rules (the UI ported from the dashboard relies on them).
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // App Router only: there is no pages/ directory.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  ...boundaryBlocks,
  {
    // Stricter than the package boundary above, so it comes after it.
    files: ['packages/workflows/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: gatewayOnly,
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
