# Implementation plan and status

Status as of 2026-10-15. **Live** means exercised against the real cloud service. **Mocked** means
covered by automated tests with fakes. **Blocked** means code exists but has never run against the
real service.

| Milestone | Scope | Status |
|---|---|---|
| M0 Foundation | Monorepo, config, Compose (Postgres + MinIO), persisted Temporal dev server, migrations, Better Auth, dev seed, doctor | **Done, live locally** |
| M1 Gateway through a Temporal Activity | Bounded model loop, live catalogue validation, budgets, usage/cost/IDs, prompt caching | **Done, live** |
| M2 E2B code | Workspaces, leases, pause/resume, path checks, artifact export to MinIO with sha256, orphan sweep | Mocked; **blocked on `E2B_API_KEY`** |
| M3 Google Chrome in E2B | Custom template, mediated Playwright-over-CDP surface, domain/DNS policy, screenshots | Template + controller written, mocked; **blocked on `E2B_API_KEY`** |
| M4 Composio | Connect Link, verified callback, explicit account per execution, discovery lock, GitHub/Calendar/Drive reads | Mocked; **blocked on `COMPOSIO_API_KEY`** |
| M5 Schedule, approval, recovery | IANA/DST schedules, overlap SKIP, catch-up, pause/resume; approval Signal + durable timer; worker and server restarts | Schedules **live**; approval and restarts on a real local Temporal server with fake activities; a live approved write needs Composio (Gmail) |
| M6 Acceptance + AWS runbook | Final report, Dockerfiles, runbook | Images build and start locally; AWS is documentation only |

## Live evidence

| Run | IDs | Result | Cost |
|---|---|---|---|
| M1 smoke (memory save) | task `72974511-526e-42c5-92a5-b7f32e6629cd`; generations `gen_01M4YZB0DG0P5KVS7RJABXX3NH`, `gen_01M4YZB1M20P8RKX3BN9NZ1W27` | completed in 3.0 s; 47 history events; cache write 1,084 tokens, then cache read 846 | $0.00022331 measured |
| M5 smoke #1 (schedule) | schedule `452ddfdf-46cc-44e0-ba12-f17fa1a15e92`; task `94fa339b-3870-44cf-97be-5a07dcb72d26` | triggered, read-only, completed; pause/resume/delete reflected in Temporal; next runs show 13:00Z → 14:00Z at the 1 Nov DST change | $0.00034065 measured |
| M5 smoke #2 (after the timezone fix) | schedule `e8f46124-831a-4eeb-9a08-4e122dd2ca20`; task `8471469d-b0a2-47a0-9775-3c35e37b4466` | answered in the user's timezone (America/Toronto) | $0.00006236 measured |

Smoke spend so far is about $0.00063 of the $1 cap. Reports are in `.local/smoke/`.

## Automated tests

| Suite | Count | Covers |
|---|---|---|
| `pnpm test` (unit) | 128 | Policy (SSRF, traversal, hashing, schemas); redaction and money; agent (MockLanguageModelV4 finish reasons and invalid args, catalogue checks, context/timezone); execution (lifecycle, leases, orphans, DNS rebinding, redirect blanking); activities on PGlite (decision dedupe, read-only mode, injection producing only an approval request, exactly-once execution with the bound account, tampering, unknown outcomes never resent, revoked accounts, cross-owner access, partial output, budget blocking, model allowlist); API on PGlite with real Better Auth (ownership, Origin checks, approvals, connections, artifacts, export/delete) |
| `pnpm test:integration` | 17 | Real Temporal dev server: approval waits, forged signals, rejection, expiry, cancellation, unknown outcomes, limits, worker restart plus replay, **Temporal server restart on a persisted DB**, scheduled child workflow; outbox and reconciler with DST-aware schedules, out-of-order pause/resume, delete without resurrection, idempotent starts, lost-start recovery, ghost closing |
| `pnpm test:e2e` | 5 | Installed Google Chrome against the running stack: login redirect, memory CRUD, schedule timezone validation, no secrets on the settings page, cross-user isolation |

## Next steps

1. With `E2B_API_KEY`: run `pnpm e2b:template:build`, then `pnpm smoke:cloud --stage=m2,m3`.
2. With `COMPOSIO_API_KEY`: run `pnpm composio:discover`, connect GitHub in the web app, then
   `pnpm smoke:cloud --stage=m4`.
3. Live approval path: connect Gmail and run a draft-creation task (approval → exactly-once). A real
   **send** only happens with the owner's explicit go-ahead for that exact message.
4. Production hardening: listed in [aws-notes.md](aws-notes.md#not-covered-yet).
