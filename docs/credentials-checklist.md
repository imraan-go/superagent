# Credentials checklist

All values live only in the gitignored `.env` (mode 600) locally, or in a deployment secret manager.
Never paste them into chat, commits, issues or logs. `pnpm setup:secret <KEY>` reads a value with a
hidden prompt and writes it to `.env` without echoing it. `pnpm setup:doctor` tests presence and
authentication without printing values.

Variables already exported in your shell take precedence over `.env`.

## Generated locally (no action)

`pnpm setup:env` creates these and never overwrites existing values:

| Key | Purpose |
|---|---|
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Local Postgres (Docker, 127.0.0.1:5432) |
| `BETTER_AUTH_SECRET` | Session signing (≥ 32 chars) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Local MinIO root credentials (127.0.0.1:9000) |
| `DEV_SEED_EMAIL`, `DEV_SEED_PASSWORD` | Development-only seed user; the seed refuses to run in production |

## Required for any live run

### Vercel AI Gateway — `AI_GATEWAY_API_KEY`

1. Vercel dashboard → your team → **AI Gateway** → **API Keys** → **Create key**.
2. Add credits under AI Gateway → **Credits** (live runs are bounded by the budgets below).
3. `pnpm setup:secret AI_GATEWAY_API_KEY`.
4. `pnpm models:verify` and `pnpm setup:doctor` (shows the credit balance, never the key).

Models default to `anthropic/claude-haiku-5.5` (`AI_MODEL_PRIMARY`, `AI_MODEL_BROWSER`) and must be on
`AI_MODEL_ALLOWLIST` and present in the live catalogue with tool use (and vision for the browser model).

### Budgets

`MAX_COST_PER_RUN` and `MONTHLY_COST_LIMIT` must be set, or live execution refuses to run.
`LIVE_SMOKE_MAX_COST` caps the cumulative spend of `pnpm smoke:cloud`. The current local values are
$0.25 per run, $10 per month and $1 for smoke tests.

## Optional capabilities

### E2B — `E2B_API_KEY` (code workspace + Google Chrome)

1. E2B dashboard (e2b.dev) → **Team / Keys** → copy the API key.
2. `pnpm setup:secret E2B_API_KEY`.
3. `pnpm e2b:template:build` builds `superagent-browser` (Google Chrome) and `superagent-code`, then
   records `E2B_BROWSER_TEMPLATE_ID` / `E2B_CODE_TEMPLATE_ID` (template names, not secrets) in `.env`.
4. Optional: set `E2B_RATE_USD_PER_SECOND` (and `E2B_RATE_SOURCE`) from your E2B plan to get
   *estimated* sandbox costs; without it sandbox cost is recorded as *unknown*.

The E2B key is used only by the worker. It is never passed into a sandbox.

### Composio — `COMPOSIO_API_KEY` (user account connections)

1. Composio dashboard (platform.composio.dev) → **Settings → API Keys** → create a project key.
2. `pnpm setup:secret COMPOSIO_API_KEY`.
3. `pnpm composio:discover` verifies the curated tools and writes `connector-catalog.lock.json`.
4. Optional custom OAuth apps: create an auth config per toolkit in the Composio dashboard and set
   `COMPOSIO_AUTH_CONFIG_<TOOLKIT>` to its `ac_…` ID. Without them Composio-managed auth is used where
   Composio offers it. Google toolkits (Gmail, Drive, Calendar) in production generally need your own
   verified Google OAuth app, and Gmail restricted scopes need Google's security assessment (CASA).
   This project does not claim that assessment.

The Composio key, session MCP URLs and headers stay in the worker/API. They are never given to the
model, a sandbox or a developer MCP.

### Temporal Cloud (opt-in; local dev server is the default)

Set `TEMPORAL_MODE=cloud`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` and either `TEMPORAL_API_KEY` or
`TEMPORAL_TLS_CERT_PATH` + `TEMPORAL_TLS_KEY_PATH` (files outside the repo).

## How the assistant asks for credentials

When a capability is missing, the assistant says:

> Please put X in the gitignored local environment file or deployment secret manager, using these
> dashboard steps; tell me when it is configured.

It never asks for tokens, passwords, private keys or browser cookies in chat.
