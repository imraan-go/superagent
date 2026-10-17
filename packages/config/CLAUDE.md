# packages/config

Environment schema and capability checks (`src/index.ts`): `EnvSchema`, `getEnv`, `requireKeys`,
`capabilityStatus`, `composioAuthConfigs`, `modelAllowlist`, `REPO_ROOT`.

## Hard rules

- Leaf package: depends only on `zod` and Node built-ins. Never import another `@superagent/*`.
- `getEnv()` loads the root `.env` once (`loadLocalEnv`); variables already in the shell win.
- Optional capabilities are optional keys. Code that needs one calls
  `requireKeys(capability, keys, hint)`, which throws `SetupRequiredError` (non-retryable in
  workflows). Do not make a third-party key required at parse time.
- Never log, return or print secret values. Error messages name missing keys only.
- Adding an env key means updating, in the same change: `EnvSchema`, `.env.example`, the allowed
  list in `scripts/set-secret.ts` if users set it with `pnpm setup:secret`, `scripts/setup-env.ts` if
  it is generated locally, and docs/credentials-checklist.md.
- Model slugs used by the app are appended to the allowlist by `modelAllowlist()`; the allowlist is
  the single gate for which models may run.

## Tests

`test/index.test.ts` stubs every schema key so the developer's shell and `.env` cannot leak in.

    pnpm vitest run --project unit packages/config

Docs: docs/credentials-checklist.md, docs/cost-and-retention.md (budget keys).
