# apps/worker

Temporal worker process (`src/index.ts`): registers the workflows and activities, drains the
transactional outbox, reconciles task projections and sweeps orphaned E2B sandboxes
(`src/reconciler.ts`).

## Hard rules

- Workflows are loaded by path (`workflowsPath: require.resolve('@superagent/workflows')`) so
  Temporal bundles them in its sandbox. Never import workflow code directly into the worker.
- Activities are registered as `createActivities(createRealDeps())` from `@superagent/activities`. A
  new activity is registered by adding it to `createActivities`; nothing changes here.
- Outbox handling (`processOutboxRow`) must stay idempotent: a row can be processed more than once.
  Rely on the idempotent helpers in `@superagent/temporal` (duplicate start, missing workflow or
  schedule are normal results). Schedule rows converge Temporal to the DB's current state.
- Claiming uses `FOR UPDATE SKIP LOCKED` (`claimOutbox`); failed rows back off and go `dead` after 50
  attempts (`failOutbox`).
- The orphan sweep kills only app-tagged sandboxes that no workspace row claims.
- Intervals: outbox poll 1 s when idle, projection reconcile 60 s, orphan sweep 15 min.
- Shut down gracefully on SIGINT/SIGTERM (`shutdownGraceTime: '20s'`).

## Imports

May import config, activities, workflows (by path only), db, temporal, observability, contracts,
execution.

## Tests

Integration only (`test/reconciler.int.test.ts`): PGlite plus a real Temporal dev server; needs the
`temporal` CLI on PATH.

    pnpm vitest run --project integration apps/worker

Run locally: `pnpm worker:dev` (log in `.local/logs/worker.log` when started by `pnpm start:all`).
Docs: docs/architecture.md, docs/temporal-policy.md.
