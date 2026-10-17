# 1. Temporal for durable agent runs

Status: Accepted

## Context

An agent run can last minutes, and it can wait up to 24 hours for an approval or an answer
(`APPROVAL_EXPIRY_HOURS`). Runs must survive worker deploys and restarts, must not double-charge
model calls or repeat external writes, and routines need timezone-aware schedules.

## Decision

Every run is a Temporal workflow (`agentTaskWorkflow` in `packages/workflows/src/index.ts`). All
side effects are Activities (`packages/activities`) behind four proxies with explicit timeouts and
retry limits (`db`, `llm`, `tools`, `writes`; see `docs/temporal-policy.md`). Waits use
`condition()` with a durable timer. Routines are Temporal Schedules (overlap SKIP, catch-up window)
that start `scheduledTaskWorkflow`. Locally a persisted dev server is used (`scripts/temporal-dev.sh`,
`.local/temporal.db`); Temporal Cloud is opt-in with `TEMPORAL_MODE=cloud`.

## Consequences

- Workflow code must be deterministic. ESLint enforces no Node I/O, no `fetch`, no `Math.random`
  and contracts-only imports for `packages/workflows/src` (`eslint.config.mjs`).
- Restarts mid-wait are covered by integration tests against a real dev server
  (`packages/workflows/test/workflows.int.test.ts`, `pnpm test:integration`).
- Changing an existing workflow's command sequence needs care for replay of running histories.
- Running locally requires the Temporal CLI (`brew install temporal`).
- Long histories are bounded with continue-as-new.
