# 6. Vercel AI Gateway with a model allowlist

Status: Accepted

## Context

Model calls cost money per user and per run, must be attributable (cost, generation ID, provider
request ID) and must use only models the operator has vetted for tool use and vision.

## Decision

All model calls go through the Vercel AI Gateway (`createGateway` in `packages/agent/src/provider.ts`).
ESLint forbids importing `@ai-sdk/openai`, `@ai-sdk/anthropic`, `openai` and `@anthropic-ai/sdk`
anywhere (`eslint.config.mjs`). A model runs only if it is on `AI_MODEL_ALLOWLIST` (plus the
configured `AI_MODEL_PRIMARY`/`AI_MODEL_BROWSER`, `modelAllowlist()` in `packages/config`), is in the
live Gateway catalogue and has the required capabilities (`checkModel` in
`packages/agent/src/catalog.ts`); otherwise `modelDecision` throws the non-retryable
`ModelConfigError`. Tools are declared without `execute`, so the SDK never runs one. Each call
reserves its worst-case cost against the per-run and monthly limits first and settles at the
measured Gateway cost afterwards.

## Consequences

- One API key and one billing surface; cost is *measured* from `providerMetadata.gateway`.
- A model picked in the composer is honoured only if the installation allows it.
- `pnpm models:verify` checks configured models against the live catalogue for free.
- Live runs refuse to start when `MAX_COST_PER_RUN` or `MONTHLY_COST_LIMIT` is unset.

Source: `docs/cost-and-retention.md`, `docs/credentials-checklist.md`, `docs/sdk-notes.md`.
