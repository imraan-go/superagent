# packages/activities

Temporal Activity implementations: model decisions, policy evaluation, tool execution, approvals,
questions, lifecycle and retention. All side effects of a run live here.

## Hard rules

- Every activity takes `(d: Deps, ref)` and is bound in `createActivities` (`src/index.ts`). Its
  signature must match `AgentActivities` in `packages/contracts/src/workflow.ts`.
- Activities must be idempotent under retry: use `dedupeKey`s on events/messages (`emit`,
  `appendMessage`) and idempotent repository calls (`createIntent` returns the existing intent).
- Always pass `ownerId` to repositories and check `tc.taskId === ref.taskId` (see `loadCall`).
- External writes (`classification: 'external_write'`) only run in `executeApprovedAction`
  (`src/actions.ts`) after `checkApproval` re-reads the persisted approval. `runConnectorRead` refuses
  them. An unknown outcome is recorded, never resent.
- For failures a retry cannot fix, throw an error whose `name` is in the workflow's `NON_RETRYABLE`
  list (`packages/workflows/src/index.ts`), e.g. `NotFoundError`, `ApprovalError`, `BudgetExceededError`,
  `ModelConfigError`. The error `name` becomes the Temporal failure type.
- Tool work runs inside `supervised()` (`src/tools.ts`), which heartbeats every 10 s and honours
  cancellation. The `tools` proxy fails an attempt after 45 s without a heartbeat.
- Content from web pages, email, documents and connectors goes back to the model wrapped in
  `UNTRUSTED ... START/END` markers.
- Model calls reserve budget before the call and settle after (`reserveBudget`/`settleReservation`).
- Never log secrets; use `d.log` (redacting) and never put keys into sandbox commands.

## Imports

May import config, contracts, db, agent, connectors, execution, storage, policy, observability.
Must not import workflows, temporal, apps/*. Add new external dependencies to `Deps` (`src/deps.ts`)
so tests can fake them.

## Tests

`test/activities.test.ts`: PGlite + fake Gateway/Composio/E2B via a fake `Deps` harness.

    pnpm vitest run --project unit packages/activities

Docs: docs/architecture.md, docs/temporal-policy.md, docs/cost-and-retention.md.
