# superagent

A consumer personal agentic assistant. A signed-in user gives the assistant a task; it plans with a
model on the **Vercel AI Gateway**, works in a private **E2B** cloud workspace (Python, files and a
sandboxed **Google Chrome**), reads the user's own accounts through **Composio** connections, and
runs durably on **Temporal** — pausing for the user's exact approval before anything leaves their
account.

> Status and what is verified live vs. only under mocks: see [docs/implementation-plan.md](docs/implementation-plan.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js client (single origin; `/api/*` is proxied to the API) |
| `apps/api` | Hono HTTP API, Better Auth sessions, ownership checks, transactional outbox writes |
| `apps/worker` | Temporal worker (workflows + activities), outbox drain, projection + E2B orphan reconciliation |
| `packages/contracts` | Zod request schemas, workflow ↔ activity contracts, event types |
| `packages/db` | Drizzle schema, migrations, owner-scoped repositories |
| `packages/workflows` | Deterministic Temporal workflows (agent task, scheduled task, retention) |
| `packages/activities` | Model decision, tool execution, approvals, lifecycle — all side effects live here |
| `packages/agent` | Gateway provider, live catalogue checks, context/prompt assembly |
| `packages/connectors` | Composio sessions adapter (explicit account per execution) |
| `packages/execution` | E2B workspaces (leases, pause/resume, orphans) and the mediated Chrome controller |
| `packages/policy` | Tool registry/classification, canonical approval hashing, SSRF/path checks, connector catalogue |
| `packages/observability` | Structured redacting logger, money helpers |
| `packages/config` · `storage` · `temporal` | Env schema, MinIO/S3 artifact store, Temporal client helpers |
| `infra/local` | Docker Compose: Postgres + MinIO (loopback-only, named volumes) |
| `infra/e2b` | E2B template definitions (Google Chrome, code) and build script |
| `infra/deploy` | Dockerfiles and the AWS runbook (documentation only; nothing is provisioned) |
| `scripts` | setup, doctor, smoke, discovery, cleanup, start/stop/reset |

## Quick start (local)

Prerequisites: Node ≥ 22.12 (24 tested), Corepack (pnpm 12), Docker (OrbStack or Docker Desktop),
Temporal CLI (`brew install temporal`).

```bash
pnpm install
pnpm setup:env            # creates .env (mode 600) with generated local secrets; prints key names only
pnpm setup:secret AI_GATEWAY_API_KEY   # hidden prompt; or export it in your shell
pnpm infra:up             # Postgres + MinIO on 127.0.0.1
pnpm temporal:dev         # separate terminal: persisted dev server (.local/temporal.db), UI on 127.0.0.1:8233
pnpm db:migrate
pnpm db:seed:dev          # development-only user (refuses when APP_ENV=production)
pnpm setup:doctor         # checks every dependency without printing secrets
pnpm worker:dev           # separate terminal
pnpm dev                  # API on 127.0.0.1:3001 and web on http://localhost:3000
```

Or `pnpm start:all` / `pnpm stop:all` to run everything in the background (logs in `.local/logs`).
Stopping keeps all data. `pnpm infra:reset` is the only command that deletes local state and it
asks for a typed confirmation.

Optional capabilities light up when their credentials exist (see
[docs/credentials-checklist.md](docs/credentials-checklist.md)):

- **E2B**: `pnpm setup:secret E2B_API_KEY`, then `pnpm e2b:template:build`.
- **Composio**: `pnpm setup:secret COMPOSIO_API_KEY`, then `pnpm composio:discover`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm setup:doctor` | Health of config, Docker, Postgres/migrations, MinIO, Temporal, Gateway, Composio, E2B, port exposure, budgets |
| `pnpm models:verify` | Validate configured models against the live Gateway catalogue (free) |
| `pnpm composio:discover` | Verify curated connector tools against your Composio project and write the lock |
| `pnpm e2b:template:build` | Build the Google Chrome and code templates on E2B |
| `pnpm test` | Unit tests (mocked models/connectors/sandboxes; PGlite for Postgres) |
| `pnpm test:integration` | Real local Temporal server: workflows, approvals, restarts, schedules, outbox |
| `pnpm test:e2e` | Playwright against the running local stack (installed Google Chrome) |
| `pnpm smoke:cloud --stage=m1,m5` | Live cloud smoke tests within `LIVE_SMOKE_MAX_COST` |
| `pnpm cleanup:cloud [--yes]` | List (and kill) app-tagged E2B sandboxes |
| `pnpm lint` · `pnpm typecheck` | ESLint (incl. workflow determinism rules) and TypeScript across all packages |

## Documentation

- [Implementation plan and status](docs/implementation-plan.md)
- [Architecture](docs/architecture.md)
- [Credentials checklist](docs/credentials-checklist.md)
- [Temporal policy](docs/temporal-policy.md)
- [E2B and Google Chrome](docs/e2b-chrome.md)
- [Composio capability matrix](docs/composio-matrix.md)
- [SDK notes](docs/sdk-notes.md)
- [Cost, limits and retention](docs/cost-and-retention.md)
- [Developer MCP setup](docs/mcp-setup.md)
- [AWS deployment notes](docs/aws-notes.md) · [runbook](infra/deploy/README.md)

## Security posture (short)

Ownership is enforced server-side on every resource. External writes require an approval bound by a
canonical hash (owner, account, tool version, destination, content, attachments, expiry, nonce) and
are re-checked against the database before execution, executed at most once, and never blindly
retried. Web/email/document content is treated as untrusted data. Secrets stay in `.env` or a secret
manager and out of logs, Temporal payloads, sandboxes and model context.

Passing tests does **not** make this system compliant with PIPEDA, CASA or any other regime, and
autonomous browsing is never fully safe; see the residual risks in
[docs/architecture.md](docs/architecture.md#residual-risks).
