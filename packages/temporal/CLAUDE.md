# packages/temporal

Temporal client helpers (`src/index.ts`): connection settings (local dev server or Temporal
Cloud), idempotent workflow start, signals, cancel, describe, and schedule create/pause/delete,
plus the daily retention schedule.

## Hard rules

- Every operation is idempotent. Task workflow IDs are `task-<taskId>` with `REJECT_DUPLICATE`
  (`startTaskWorkflow` returns `'already_started'`); schedules are `sched-<scheduleId>`; "not found"
  and "already exists" map to return values, not throws.
- Signals carry only an ID (`{intentId}` / `{questionId}`). Never send content or decisions in a
  signal; the workflow re-reads Postgres.
- Only the worker (outbox drain and reconciler in `apps/worker/src/reconciler.ts`) and scripts call
  these helpers. The API must not: it writes an outbox row instead.
- Use the IDs and names from `@superagent/contracts/workflow` (`taskWorkflowId`,
  `scheduleTemporalId`, `*_WORKFLOW_TYPE`, `APPROVAL_SIGNAL`). Renaming them strands running
  workflows and schedules.
- Cloud credentials (`TEMPORAL_API_KEY`, mTLS paths) come from config and are never logged.

## Imports

May import config, contracts, `@temporalio/client`, `@temporalio/common`.

## Tests

No unit tests. Covered by the worker's integration test against a real dev server:

    pnpm vitest run --project integration apps/worker

Docs: docs/temporal-policy.md, docs/architecture.md (Request path and dual writes).
