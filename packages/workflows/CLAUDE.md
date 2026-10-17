# packages/workflows

Deterministic Temporal workflows: `agentTaskWorkflow`, `scheduledTaskWorkflow`, `retentionWorkflow`
(`src/index.ts`).

## Hard rules

- Workflow code must be deterministic. No I/O, SDK clients, DB, filesystem, `fetch`, host timers or
  `Math.random`. Every side effect goes through an Activity proxy.
- Imports are limited to `@temporalio/workflow`, `@temporalio/common` and `@superagent/contracts`
  (`/workflow`). `eslint.config.mjs` enforces this for `src/**` (no `node:*`, `fs`, `crypto`, `http`,
  `https`, `net`, no other `@superagent/*`, no `fetch`, no `Math.random`).
- Time comes from the workflow runtime: `Date.now()` is replay-safe here (Temporal patches it) and is
  already used for the active-time budget. Use `uuid4()` from `@temporalio/workflow` for IDs.
- Waits use `condition(pred, timeout)` (durable timer). After a signal, always re-read the persisted
  approval/answer through an Activity (`checkApproval`, `checkQuestion`); a signal is never authority.
- Payloads carry IDs only (`taskId`, `ownerId`, `toolCallId`, `intentId`, `questionId`). Never put
  prompts, tool args or results into workflow input, signals or carry state.
- Use the existing proxies and their policy (docs/temporal-policy.md): `db` (30 s, 8 attempts),
  `llm` (3 min, 2 attempts), `tools` (6 min, 45 s heartbeat, 1 attempt), `writes` (2 min, 1 attempt).
  External writes go through `writes` and are never retried; failures go to `reconcileAttempt`.
- Changing the order or number of Activity calls in an existing workflow breaks replay of running
  histories. Use `patched()` from `@temporalio/workflow` or ship it as a new code path.
- The Activity surface is the `AgentActivities` interface in `packages/contracts/src/workflow.ts`.
  `src/activity-types.ts` is an older, unused set of interfaces; do not build on it.

## Tests

Integration only (real Temporal dev server, needs the `temporal` CLI on PATH, fake activities):

    pnpm vitest run --project integration packages/workflows

The fake `AgentActivities` object in `test/workflows.int.test.ts` must implement every activity, so
adding one to the contract means adding a fake there. Typecheck: `pnpm --filter @superagent/workflows typecheck`.

Docs: docs/temporal-policy.md, docs/architecture.md (agent loop).
