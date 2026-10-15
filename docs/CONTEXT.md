# CONTEXT.md — master context & memory

> Single source of truth for any AI/human working on tj-lhos-panel.
> Keep §Decisions and §State current. Linked from `.cursor/rules/00-project.mdc`.

## 1. What we are building
A **personal super-agent platform** for one owner (single login). Think Grok's app:
chat with a super-intelligent agent that can *actually do things* — because it is
wired to a self-hosted **LHOS agent computer**: a persistent Linux desktop sandbox
(E2B self-host) with 100 MCP tools (shell, GUI computer-use, Playwright browser,
RDP to the owner's Windows VPS, files, workflows, scheduler, webhooks, credential
vault, HITL approvals) plus live VNC for human watch/takeover.

The panel adds on top: multi-model orchestration (OpenAI/Anthropic/OpenRouter),
chat history + memory (pgvector), token & cost metering in realtime, file/image
upload, connectors (Composio, Pipedream), schedules/triggers/webhooks UI,
approval + takeover UX, and a **Manage** mode that is the admin dashboard of the
LHOS/E2B system itself.

## 2. The existing backend (DO NOT rebuild — integrate)
Runs on the same VPS, systemd-managed, behind Caddy (ports 80/443):

| Thing | Where | Notes |
|---|---|---|
| Agent server source | `/root/e2b-agent-vm` | Python; `bin/mcp_server.py` = MCP + REST + vault + approvals |
| MCP endpoint | `https://mcp.hostx.h22t.com/mcp` | Bearer token (env `LHOS_MCP_TOKEN`) |
| REST API | `https://mcp.hostx.h22t.com/api/*` | same bearer; see API_REFERENCE.md |
| VNC viewer | `https://vnc.hostx.h22t.com/` | cookie session after access-code sign-in |
| Approvals (human) | `https://mcp.hostx.h22t.com/approvals?token=…` | separate token, human-only |
| Vault intake page | `https://mcp.hostx.h22t.com/vault?token=…` | add API keys w/o exposing to agent |
| E2B API | `http://hostx.h22t.com:3000` (+`:3002`) | `X-API-KEY` from `/root/e2b-install/secrets/team_api_key` |
| Secrets | `/root/e2b-agent-vm/secrets/` | `mcp_token`, `vnc_token`, `approve_token` files |
| Config | `/root/e2b-agent-vm/config.env` | RDP profiles, dirs, ports |
| Manage CLI | `/root/e2b-agent-vm/bin/manage.sh` | status/url/sleep/wake/rotate-auth/new-desktop/logs |
| systemd units | e2b-infra, e2b-api, e2b-orchestrator, e2b-client-proxy, e2b-firewall, e2b-desktop-vnc, e2b-mcp, e2b-scheduler, caddy | Manage tab controls these |
| Daily reports/events | `/root/e2b-agent-vm/logs/` (`events/YYYY-MM-DD.jsonl`, `YYYY-MM-DD.md`) | also via REST `/api/events`, `/api/report` |
| Persistent VM data | guest `~/persist` ↔ host mirror | Manage tab file listing |

Run `bash scripts/sync-env.sh` to populate `.env.local` with the live tokens
(reads the secrets files directly; values must never appear in code/docs/chat).

## 3. Product surface (owner-approved spec)
- **Login** (owner only) → splash/boot animation → main app.
- **Top navbar:** brand, **Agent / Manage** mode switch, connection dot, theme, owner menu.
- **Left sidebar (Grok-style):** new chat, search, pinned, chat history (grouped by
  time), skills/workflows shortcut; **settings icon pinned at the bottom** opening a
  Settings modal with left-tab navigation.
- **Center:** chat column — streaming markdown, tool-step chips (expandable), inline
  images/screenshots, file/image upload (drag-drop + paste), prompt input with
  model picker, pace toggle, mic placeholder, animated reactive loader while thinking.
- **Right sidebar ("Mission panel", Claude-style):** 
  - top: **live AI token counter + running cost** (per-chat and today, SSE ticker);
  - run progress timeline (steps, tool calls, screenshots);
  - approvals queue (approve/reject inline);
  - **Computer panel:** embedded live VNC view with Watch / **Take control** states,
    expandable to full-screen takeover; shown automatically when agent requests takeover.
- **Settings modal tabs:** Models (vendor keys, model enable/disable, default,
  per-model pricing override) · Agent (system prompt, pace, max steps, auto-approve
  OFF) · Approvals & Takeover policy · Connectors (Composio, Pipedream, custom MCP/
  REST connectors) · Schedules & Triggers (cron UI, webhook URLs, run-now) ·
  Notifications & Sound · Appearance · Data (export, retention) · Danger zone.
- **Manage mode (navbar switch):** E2B system dashboard — service status cards +
  start/stop/restart, desktop sleep/wake/new-desktop, live stats (CPU/RAM/disk),
  logs viewer, events/report browser (the generated `.md` daily files listed +
  rendered), persist-data file manager, snapshot list, firewall/token rotation,
  toggles (maintenance, snapshot-prune stays OFF), config viewer (values masked).
  Spec: `docs/MANAGE_TAB.md`.

## 4. Decisions (append-only; newest last)
- 2026-10-15 Single Next.js app for FE+BE; Drizzle + Postgres16 + pgvector; SSE not WS.
- 2026-10-15 Design language "Flight Deck" (see DESIGN_SYSTEM.md) — distinct from Grok.
- 2026-10-15 Browser never holds LHOS/vendor keys; all proxied via API routes.
- 2026-10-15 Approvals remain human-only; agent cannot approve its own checkpoints.
- 2026-10-15 Dockerized; joins host Caddy via reverse proxy `panel.hostx.h22t.com`
  (same-site with vnc.hostx.h22t.com so the VNC iframe session cookie works).
- 2026-10-15 No anti-detection features ever; pacing = rate limiting only.
- 2026-10-15 Live probe of the LHOS host done; `docs/IMPLEMENTATION_PLAN.md` is the
  execution contract (baseline, ground-truth doc corrections, ADRs, risks,
  per-phase acceptance criteria). Where older docs disagree with it, it wins.
- 2026-10-15 ADR-01 Tool execution goes over LHOS **REST** (`POST /api/tools/<name>`),
  not the MCP SDK — same 100 tools, typed envelope with `ok`/`ms`, no session
  lifecycle. Supersedes "MCP for the agent loop" in rules/20-api-mcp.mdc.
- 2026-10-15 ADR-02 HITL = 3 kinds / 2 answer channels: `confirm` → approvals proxy
  (`POST /approvals/{id}/approve|reject?token=`), `ask`/`takeover` → host bridge
  (`manage.sh answer|done`). One poll source, two decision paths.
- 2026-10-15 ADR-03 Panel Postgres publishes on host **5433** (5432 is E2B's).
- 2026-10-15 ADR-04 Single Next.js instance, on purpose — run registry is in-process.
- 2026-10-15 ADR-05 Added `run_events` table; SSE resume replays it by `seq`.
- 2026-10-15 ADR-06 Curated ~40-tool default allowlist (all 100 schemas ≈ 11k tokens
  per request and dilutes attention); RDP + raw GUI-click family opt-in.
- 2026-10-15 ADR-07 Tool images → files volume + `files` row + URL; never base64 in
  chat state or SSE; only the latest 2 screenshots stay in model context.
- 2026-10-15 ADR-08 Pace mapping: fast = 4 s gap / 60 per hour, careful = 12 s / 20.
- 2026-10-15 ADR-09 **Next.js 16.4.1**, not 15 (owner-approved). `cacheComponents`
  (PPR) left OFF: the panel is almost entirely dynamic and session-gated, so it
  would add `use cache` + Suspense ceremony for no gain. Tailwind v4 runs through
  `@tailwindcss/postcss`, not the Turbopack CSS loader — that loader's `*.css`
  glob also swallows `*.module.css`, and the primitives are CSS Modules.
- 2026-10-15 ADR-10 Owner credential lives in the `users` table (set by
  `npm run owner:set-password`, argon2id). `OWNER_PASSWORD_HASH` in env is unused.
- 2026-10-15 ADR-11 CSRF compares the `Origin` **host** against
  `x-forwarded-host`/`host`, never `nextUrl.origin` — Next normalises that to
  localhost and Caddy terminates TLS, so a full-origin match breaks in both
  dev and production.
- 2026-10-15 ADR-12 Tool calls are **never retried**, at any layer. They are not
  idempotent — a retried `desktop_click` clicks twice. Only GET reads retry, and
  the "waking up" backoff applies to the agent loop deciding to re-attempt a
  step, never to the HTTP client silently repeating a POST.
- 2026-10-15 ADR-13 Status endpoints (`/api/lhos/capabilities`, `/api/approvals`)
  answer `200 {reachable:false, code}` instead of a 5xx. They are polled, and an
  unreachable agent computer is a normal product state, not a request failure.
- 2026-10-15 ADR-14 Every authenticated API route goes through `ownerRoute`
  (`src/server/lib/route.ts`), which verifies the sealed session and maps
  `AppError` → status. Middleware is a fast filter, not the authorisation check.
- 2026-10-15 ADR-15 The tool catalogue is cached in-process for 5 minutes with
  stale-on-error fallback. Valid only because the panel is single-instance
  (ADR-04); revisit if that ever changes.
- 2026-10-15 ADR-16 Live LHOS assertions live in `tests/smoke/` behind
  `LHOS_LIVE=1` (`npm run test:smoke`), never in the default unit run. The tool
  envelope is the one contract types cannot verify, and read-only tools make it
  safe to assert against the real server.

## 5. State (update as you go)
- Phase: **1 — shell & chat core.** The LHOS gateway, the `/api/lhos/*` proxies
  and the live connection dot are done and verified against the real sandbox.
  Next action: chat CRUD + message persistence, then the model adapters.
- Local dev works: `docker compose up -d db` → `npm run db:migrate` → `npm run dev`
  on :3100. Owner account exists (`owner@h22t.com`); primitives proof sheet at
  `/dev/primitives`.
- Nothing deployed. Domain `panel.hostx.h22t.com` not yet in Caddyfile.
- Backend verified live 2026-10-15: 100 tools, capabilities/events/report/approvals
  all 200, E2B health 200, VNC 302→sign-in. `.env.local` has LHOS + E2B tokens.
- **No vendor model key set yet** — the agent loop has no brain until the owner adds
  one (Settings → Models, or `.env.local`). Tracked in IMPLEMENTATION_PLAN §8.
- Host constraints: disk 78 % (26 GB free), ~5 GB RAM free, port 5432 occupied.

## 6. Memory conventions
- Durable facts/decisions → this file. Task state → TODO.md. History → CHANGELOG.md.
- Embeddings memory (chat-recall across sessions) lives in DB table `memories`
  (pgvector); the agent loop upserts and recalls automatically (ARCHITECTURE.md §Memory).
