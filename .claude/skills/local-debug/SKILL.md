---
name: local-debug
description: Diagnoses a broken local dev stack (Postgres, MinIO, Temporal, worker, API, web) with the doctor, compose status, logs and the Temporal UI, and fixes the common failures, including the failed `CREATE SCHEMA "drizzle"` migration caused by a Postgres password mismatch. Use when a local command, migration, worker, API or web page fails, or something "is not running".
---

# Debug the local stack

Never print or paste secret values from `.env` while debugging. Run from the repo root.

1. **Dependencies first.** In a fresh git worktree `node_modules` is missing; errors like
   `Cannot find package 'zod'` or `tsx: command not found` mean: run `pnpm install`.

2. **Run the doctor:**

       pnpm setup:doctor

   It checks `.env` (exists, mode 600), config validity, node/temporal/docker, Postgres and
   migrations, MinIO, Temporal, loopback-only ports, Gateway, Composio and E2B, without printing
   secrets. Fix `fail` lines first. No `.env`: `pnpm setup:env`.

3. **Containers:** `pnpm infra:status` (Postgres on 127.0.0.1:5432, MinIO on 9000/9001). If they are
   down: `pnpm infra:up`. Container logs:

       docker compose -f infra/local/compose.yaml --env-file .env logs postgres

4. **Process logs.** `pnpm start:all` writes `.local/logs/{temporal,worker,api,web}.log` and PIDs to
   `.local/pids/`. Look at the newest error: `tail -n 100 .local/logs/worker.log`. API and worker
   logs are redacted JSON lines with `level`, `component` and `msg`.

5. **Temporal.** `pnpm temporal:dev` (or `start:all`) serves gRPC on 127.0.0.1:7233 and the UI on
   http://127.0.0.1:8233. Find the run by workflow ID `task-<taskId>` and read the failed activity's
   error. "Temporal CLI not found": `brew install temporal`. Workflow state persists in
   `.local/temporal.db`.

6. **Migration fails with `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`.** That is Drizzle's
   wrapper; the real error is on the `cause:` line printed by `packages/db/src/migrate.ts`.
   - `cause: password authentication failed for user "superagent"`: the Postgres volume was created
     with a different password than `.env` has. Postgres reads `POSTGRES_PASSWORD` only when the
     volume is first created. The local password is fixed to `superagent`
     (`LOCAL_POSTGRES_PASSWORD` in `scripts/setup-env.ts`), but older `.env` files have a random one
     and `pnpm setup:env` never overwrites existing values. Fix without losing data:
     1. In `.env` set `POSTGRES_PASSWORD=superagent` and
        `DATABASE_URL=postgres://superagent:superagent@127.0.0.1:5432/superagent`.
     2. Set the same password inside the container (local socket auth needs no password):

            docker compose -f infra/local/compose.yaml --env-file .env exec postgres \
              psql -U superagent -d superagent -c "ALTER USER superagent PASSWORD 'superagent';"

     3. `pnpm db:migrate`, then `pnpm setup:doctor`.
   - `cause: connect ECONNREFUSED 127.0.0.1:5432`: Postgres is not running; `pnpm infra:up`.
   - A shell-exported `DATABASE_URL` overrides `.env`; check `echo ${DATABASE_URL:+set}`.

7. **Other common failures.**
   - Doctor `postgres` warns "run `pnpm db:migrate`": tables are missing; migrate.
   - API/worker exits with "... is not configured. Missing: X": add X with `pnpm setup:secret X`
     (third-party keys) or `pnpm setup:env` (local ones). See docs/credentials-checklist.md.
   - Tasks stay `queued`: the worker is not running or cannot reach Temporal. Check
     `.local/logs/worker.log`; the reconciler re-enqueues lost starts every 60 s.
   - `model ... rejected: ...` (`ModelConfigError`): run `pnpm models:verify` to see which check
     fails (allowlist, live Gateway catalogue, tool use/vision), then fix `AI_MODEL_*` in `.env`.
   - Port in use: `lsof -nP -iTCP:3000 -sTCP:LISTEN` (also 3001, 7233, 8233); `pnpm stop:all`
     stops what `start:all` started and keeps data.

8. **Last resort:** `pnpm infra:reset` deletes ALL local data (Postgres and MinIO volumes and
   `.local/temporal.db`) after a typed confirmation. Only suggest it when the data is disposable and
   the owner agrees; never run it to fix a password mismatch.

9. If you changed code or setup to fix the problem, run `pnpm check` (format, lint, typecheck, unit tests)
   and update README.md, `docs/` or the relevant `CLAUDE.md` if behavior changed.
