---
name: add-workflow-activity
description: Adds a Temporal Activity and calls it from a workflow - contract in packages/contracts, implementation in packages/activities, worker registration, deterministic call from packages/workflows with the documented retry/timeout policy, and tests. Use when a workflow needs a new side effect (DB write, model call, sandbox, connector) or a new step in the agent loop.
---

# Add an Activity and wire it into a workflow

Read `packages/workflows/CLAUDE.md`, `packages/activities/CLAUDE.md` and `docs/temporal-policy.md`
first.

1. **Contract.** Add the method to `AgentActivities` in `packages/contracts/src/workflow.ts`.
   - Input is references only: extend `TaskRef`, `ToolRef`, `IntentRef` or `QuestionRef`. No prompts,
     tool arguments, results, tokens or file contents (they go in Postgres/MinIO and the activity
     loads them).
   - Output is small and serialisable (states, IDs, counts, short summaries). Add new result types
     in the same file. Keep the file free of runtime imports (it is bundled into workflow code).

2. **Implement** in `packages/activities/src/<area>.ts` (`lifecycle.ts`, `tools.ts`, `actions.ts`,
   `questions.ts`, `model.ts`) as `export async function name(d: Deps, ref: ...)`.
   - Idempotent under retry: use `dedupeKey`s (`emit`, `appendMessage`) and upserts or
     "return existing" checks.
   - Owner-scoped: every repository call gets `ref.ownerId`; check that loaded rows belong to
     `ref.taskId`.
   - Failures a retry cannot fix throw an error whose `name` is in `NON_RETRYABLE` in
     `packages/workflows/src/index.ts` (add the name there if it is a new error class).
   - Long-running work (sandbox, browser, connector) runs inside `supervised()` in `src/tools.ts` so
     it heartbeats and honours cancellation.
   - A new external dependency becomes a field on `Deps` in `src/deps.ts`, built lazily in
     `createRealDeps()`, so tests can fake it.

3. **Register.** Bind it in `createActivities` in `packages/activities/src/index.ts`
   (`name: (r) => area.name(d, r)`). The worker (`apps/worker/src/index.ts`) registers
   `createActivities(createRealDeps())`, so it needs no change.

4. **Call it from the workflow** in `packages/workflows/src/index.ts` through the proxy that matches
   its side effect (`docs/temporal-policy.md`):
   - `db` (30 s, up to 8 attempts): idempotent DB/projection work.
   - `llm` (3 min, 2 attempts): model calls, deduplicated per step.
   - `tools` (6 min, 45 s heartbeat, 1 attempt, waits for cancellation): sandbox/browser/connector
     reads.
   - `writes` (2 min, 1 attempt): non-idempotent external writes. Never retried; on a throw call
     `reconcileAttempt`.
   - Determinism: no I/O, `fetch`, Node modules, `Math.random` or imports other than
     `@temporalio/workflow`, `@temporalio/common` and `@superagent/contracts`. `pnpm lint` checks
     this.
   - Inserting or reordering activity calls in an existing workflow breaks replay of histories that
     are already running. Guard the new call with `patched('<change-id>')` from
     `@temporalio/workflow`, or make sure no affected workflow is running.
   - A new proxy or timeout needs a row in the "Activity options" table in `docs/temporal-policy.md`.

5. **Tests.**
   - Unit-test the activity in `packages/activities/test/activities.test.ts` (PGlite + fake `Deps`
     harness): happy path, retry returns the same result, another owner gets `NotFoundError`.

         pnpm vitest run --project unit packages/activities

   - Add the activity to the fake `AgentActivities` in `packages/workflows/test/workflows.int.test.ts`
     (typecheck fails otherwise) and a scenario for the new workflow path. Needs the `temporal` CLI:

         pnpm vitest run --project integration packages/workflows

   - `pnpm lint` (workflow determinism rules) and `pnpm typecheck`.

6. **Docs**: `docs/temporal-policy.md` (activity options, retries) and the agent-loop steps in
   `docs/architecture.md` if the loop changed.

7. Run `pnpm check` (format, lint, typecheck, unit tests) and update README.md, `docs/` or the relevant
   `CLAUDE.md` if behavior changed.
