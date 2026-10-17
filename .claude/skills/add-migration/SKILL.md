---
name: add-migration
description: Adds or changes a Postgres table, column or index in packages/db (Drizzle schema, generated SQL migration, owner-scoped repository functions, tests, docs). Use when adding or changing a database table or column, an index or constraint, or a repository function that needs new schema.
---

# Add a database migration

Read `packages/db/CLAUDE.md` first. Run every command from the repo root.

1. **Edit the schema** in `packages/db/src/schema.ts`.
   - User-owned tables get `ownerId: owner()` (`owner_id` -> `user.id`, cascade delete) and an index
     that starts with `owner_id` for the queries you will run.
   - Timestamps use the local helpers `created()`, `updated()` and `ts(name)` (timestamptz).
   - Content that must not reach Temporal history (prompts, tool args, results) belongs here, never
     in workflow payloads.
   - Prefer additive changes (new nullable column, new table). Renames and drops break the API and
     worker if they run against the new schema during a rollout.

2. **Generate the migration** with a descriptive snake_case name:

       pnpm db:generate --name <short_name>

   This runs `drizzle-kit generate` in `packages/db` (`drizzle.config.ts`) and writes
   `packages/db/migrations/NNNN_<short_name>.sql` plus `migrations/meta/NNNN_snapshot.json` and an
   entry in `migrations/meta/_journal.json`. It does not need a running database.

3. **Review the generated SQL** in `packages/db/migrations/NNNN_<short_name>.sql`:
   - Only the change you intended; no unexpected `DROP` or type change.
   - `NOT NULL` columns on existing tables have a default, or the migration fails on existing rows.
   - Foreign keys to `user` use `ON DELETE cascade` so `DELETE /api/me/data` removes everything.
   - Do not hand-edit committed migrations. If the SQL is wrong, fix `schema.ts`, delete the new
     `.sql`, its snapshot and journal entry, and generate again.

4. **Apply it locally** (needs `pnpm infra:up`):

       pnpm db:migrate

   If it fails with `Failed query: ...`, read the `cause:` line; see the `local-debug` skill.

5. **Add or adjust repository functions** in `packages/db/src/repos/<area>.ts` and export new files
   from `packages/db/src/index.ts`.
   - Signature `(db: DbOrTx, ownerId: string, ...)`; filter every query with
     `eq(<table>.ownerId, ownerId)`.
   - Reject malformed IDs with `isUuid` and throw `NotFoundError` for missing or foreign rows.
   - If the change must reach Temporal, insert the row and a `workflow_outbox` row in the same
     `db.transaction` (pattern: `createTaskWithOutbox` in `repos/tasks.ts`).
   - Event payloads go through `appendEvent`, which redacts them.

6. **Test** in `packages/db/test/repos.test.ts` (PGlite applies the real migrations through
   `test/helpers.ts`). Cover the happy path and a cross-owner read/write that must throw
   `NotFoundError`:

       pnpm vitest run --project unit packages/db

   Then run the dependants that touch the table, e.g.
   `pnpm vitest run --project unit packages/activities apps/api`.

7. **Update callers**: API routes (`apps/api/src`), activities, and Zod request schemas in
   `packages/contracts/src/index.ts` if the API accepts the new field. If the column holds user
   content, check retention (`runRetention` in `packages/activities/src/lifecycle.ts`) and data
   export/deletion in `apps/api/src/app.ts`.

8. **Docs**: update `docs/architecture.md`, `docs/web-app.md` or `docs/cost-and-retention.md` if
   the data model or retention changed.

9. Run `pnpm check` (format, lint, typecheck, unit tests) and update README.md, `docs/` or the relevant
   `CLAUDE.md` if behavior changed.
