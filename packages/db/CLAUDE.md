# packages/db

Drizzle schema (`src/schema.ts`), SQL migrations (`migrations/`) and repository functions
(`src/repos/*.ts`), exported from `src/index.ts`.

## Hard rules

- Repositories are owner-scoped. A function that reads or changes a user's rows takes
  `(db: DbOrTx, ownerId, ...)` and filters by `ownerId`. A foreign or unknown ID throws
  `NotFoundError` (never "forbidden"), so cross-owner IDs look like 404s. Validate UUID inputs with
  `isUuid` before querying (see `getTaskForOwner` in `src/repos/tasks.ts`).
- Only worker-internal functions (outbox claiming, `listNonTerminalTasks`, retention) work across
  owners. Do not call them from request handlers.
- New user-owned tables use the `owner()` column helper (`owner_id` -> `user.id`, cascade delete).
- Any mutation that must reach Temporal writes its rows and a `workflow_outbox` row in the same
  transaction (`createTaskWithOutbox`, `createScheduleWithOutbox`, `enqueueOutbox`).
- Approval intents are immutable and hashed with `intentHash` from `@superagent/policy`
  (`src/repos/approvals.ts`). Do not change the binding fields or their normalisation; old hashes
  would stop matching.
- Event `data` goes through `redact()` before insert (`appendEvent`). Do not bypass it.
- Never hand-edit `migrations/*.sql` or `migrations/meta/*` after they are committed. Change
  `src/schema.ts` and run `pnpm db:generate` (see `.claude/skills/add-migration`).
- Errors are classes in `src/errors.ts`; their `name` is used by Temporal's non-retryable list.

## Imports

May import config, contracts, policy, observability. Must not import activities, agent, connectors,
execution, workflows, temporal or apps/*.

## Tests

`test/repos.test.ts` runs on PGlite with the real migrations (`test/helpers.ts: createTestDb`). Other
packages reuse that helper.

    pnpm vitest run --project unit packages/db

Commands: `pnpm db:generate` (drizzle-kit, `drizzle.config.ts`), `pnpm db:migrate` (`src/migrate.ts`).
Docs: docs/architecture.md (dual writes, ownership), docs/sdk-notes.md (drizzle).
