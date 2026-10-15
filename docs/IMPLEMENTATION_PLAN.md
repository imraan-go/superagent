# Implementation Plan — production build

> Authored 2026-10-15 after a live probe of the LHOS/E2B host. This is the
> execution contract: *how* TODO.md gets built, what "done" means per phase, and
> which constraints are non-negotiable. Decisions here are mirrored into
> `docs/CONTEXT.md` §Decisions. Where this plan and older docs disagree, this
> plan wins (it was verified against the running system).

## 1. Baseline — verified, not assumed (probe 2026-10-15)

| Check | Result |
|---|---|
| `GET /api/tools` | 200 · **100 tools** · 42.9 KB of JSON Schema · items are `{name, description, input_schema}` |
| `GET /api/capabilities` | 200 · `{desktop{up,sandbox_id}, linux_browser, rdp{connected,profile,profiles,…}, api{credentials,connectors}, skills[], pace{mode,min_gap_s,max_per_hour}, pending_human_requests}` |
| `GET /api/approvals` | 200 · **2 pending** · items are `{id, kind, prompt, created}` |
| `GET /api/events` | 200 · `{ts, iso, tool, ms, ok, err, images, client, via}` |
| `GET /api/report` | 200 · `text/markdown`, summary table + sections |
| VNC `https://vnc.hostx.h22t.com/` | 302 → access-code sign-in (as expected for iframe) |
| E2B API `:3000/health` | 200 (key from `/root/e2b-install/secrets/team_api_key`) |
| `.env.local` | LHOS_MCP_TOKEN, LHOS_APPROVE_TOKEN, E2B_API_KEY, PANEL_SECRET_KEY **populated**; vendor keys empty |
| Toolchain | Node 22.23.3 · npm 10.9.9 · Docker 29.9.0 · Compose v5.6.0 |
| Host | 15 GB RAM (~5 GB free) · 118 GB disk at **78 %** (26 GB free) |
| Ports | **5432 occupied** by E2B's `local-dev-postgres-1`; 3100 free |
| Repo | **not a git repository**; zero application code |

## 2. Ground-truth corrections to existing docs

These are the places the written docs diverge from the live server. Code follows
reality; the docs get patched (rule 40-workflow §1).

1. **Tool execution envelope.** `POST /api/tools/<name>` does not return the raw
   tool result. It returns
   `{ok: boolean, tool: string, ms: number, result: Block[]}` where
   `Block = {type:"text", text} | {type:"image", mime, data_b64} | {type:"json", data}`.
   Errors return `{ok:false, error}` with 400 (unknown tool / validation) or 500.
2. **Approvals payload.** `GET /api/approvals` returns `{id, kind, prompt, created}`
   — not `{approval_id, workflow, step, prompt, ts}`. `id` is 8 hex chars,
   `created` is a float UNIX timestamp, and `kind` ∈ `confirm | ask | takeover`.
   It lists **all** pending HITL records, not only workflow confirms.
3. **Approve / reject route exists and is exact:**
   `POST {LHOS_BASE_URL}/approvals/{id}/approve|reject?token={APPROVE_TOKEN}`
   → `{ok:true, answer:"approved"|"rejected"}`. It rejects any record whose
   `kind !== "confirm"` with 404.
4. **`ask` and `takeover` cannot be answered through the approvals route.** They
   are answered either inside the desktop (zenity writes
   `/home/user/.agentvm/hitl/<id>.ans`) or host-side via
   `manage.sh answer <id> "<text>"` / `manage.sh done <id>`.
5. **`set_pace` signature** is `{mode, min_gap_seconds, max_actions_per_hour}`,
   and `mode` is a free string, not a `fast|careful` enum. Current live state is
   `fast / 4 s / 60 per hour`.
6. **`/api/tools` has no pagination and no per-tool fetch** — it is one 43 KB
   document. Cache it; never put all 100 schemas in a model request (§4 ADR-07).

## 3. Architecture decisions added by this plan

**ADR-01 — Execute tools over REST, not the MCP SDK.**
`/api/tools/<name>` exposes the identical 100-tool surface behind the same bearer
token, and its envelope already carries `ok` and server-measured `ms`, plus
normalized text/image/json blocks. That is exactly what `run_steps` and the step
chips need. The MCP Streamable HTTP transport would add session lifecycle,
reconnect handling and SDK coupling for no extra capability. `@modelcontextprotocol/sdk`
stays out of the critical path; revisit only if MCP-only features (server
notifications, sampling) become necessary. Supersedes the "MCP for the agent
loop" line in `.cursor/rules/20-api-mcp.mdc`.

**ADR-02 — HITL is three kinds over two answer channels.** The panel models
`confirm` (→ approvals proxy, `APPROVE_TOKEN`, owner session only) separately
from `ask` / `takeover` (→ host bridge `manage.sh answer|done`). One polling
source (`GET /api/approvals`), two decision paths, one `approvals` table with a
`kind` column.

**ADR-03 — Panel Postgres publishes on host port 5433.** 5432 belongs to E2B's
stack. Inside the compose network the service stays `db:5432`; only the host
mapping moves. `pg_dump` backups and local `drizzle-kit` use 5433.

**ADR-04 — Single-instance runtime, deliberately.** The run registry (abort
controllers + live SSE subscriber sets) is in-process module state. The panel
therefore runs exactly one Next.js instance. Scaling out would require moving the
registry to Postgres `LISTEN/NOTIFY`; that is explicitly out of scope and
recorded so nobody "fixes" it by adding replicas.

**ADR-05 — SSE resumability needs an event log table.** `runs` + `run_steps` can
not reconstruct a token-level stream. Add `run_events(run_id, seq, type, data,
ts)`, append-only, `seq` monotonic per run. SSE `id:` = `seq`; on reconnect with
`Last-Event-ID` the route replays `seq > N` from Postgres and then attaches to
the live stream. This is a schema addition to `docs/ARCHITECTURE.md` §Database.

**ADR-06 — Tool allowlist is a default, not an escape hatch.** Shipping all 100
schemas costs ~11 k tokens per request and measurably dilutes model attention.
Ship a curated default allowlist (observe/vision, browser, shell+files, workflow,
schedule, HITL, http_request, pace — roughly 40 tools), with RDP and the raw
GUI-click family opt-in per chat. Settings → Agent edits the list; the loop also
hard-filters anything not present in the live catalog.

**ADR-07 — Images never enter chat state as base64.** Image blocks are decoded
server-side, hashed (sha256), written to the files volume, recorded in `files`,
and referenced by URL in both the SSE stream and the model context. Only the two
most recent screenshots stay in model context (skill-agent-loop §Gotchas).

**ADR-08 — Pace mapping.** Settings' `fast|careful` maps to concrete `set_pace`
arguments: `fast` → `min_gap_seconds 4 / max_actions_per_hour 60`; `careful` →
`12 / 20`. This is rate limiting only — never evasion (rule 00/30).

## 4. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Disk at 78 % — Docker images + `node_modules` + pgdata + uploads | High | Multi-stage build, `.dockerignore`, prune after builds, uploads capped, `df` guard in Manage; alert ≥85 % |
| R2 | ~5 GB free RAM; Next build is memory-hungry alongside the live agent stack | High | Build with `NODE_OPTIONS=--max-old-space-size=3072`, never build while a run is active, prefer building images over `next dev` in prod |
| R3 | Caddy buffering breaks SSE | High | Explicit `flush_interval -1` in the panel site block; smoke-test the ticker through Caddy, not just localhost |
| R4 | VNC iframe cookie requires same-site `*.h22t.com` | High | `panel.hostx.h22t.com` from day one; dev fallback is the "Connect computer view" popup |
| R5 | Editing the host Caddyfile can take the live `mcp.`/`vnc.` sites down | High | `caddy validate` before reload, keep a timestamped backup, reload (not restart), verify all three hosts after |
| R6 | Token rotation (`manage.sh rotate-auth`) invalidates the panel's env mid-session | Medium | Rotation flow in Manage re-runs `sync-env.sh` and prompts a panel restart; client shows "reconnecting" |
| R7 | A runaway agent loop burns money | High | `maxSteps` 40 + `maxCostUsdPerRun` $2 hard stops, daily budget warning, cost ticker, cancel aborts model stream *and* in-flight LHOS call |
| R8 | Desktop recreating (30–60 s) looks like a hard failure | Medium | Retryable-error classifier, "computer waking up" step, 30 s backoff ×4 |
| R9 | Secret leakage into model context or client bundle | Critical | Server-only modules, no `NEXT_PUBLIC_` for anything sensitive, `secrets` table AES-256-GCM, last-4 only in UI, no reveal endpoint, lint rule against `process.env` in client components |
| R10 | Long-blocking tools (`ask_user` waits ≤110 s) stall the loop | Medium | 120 s client timeout, treat `PENDING id=` responses as a poll handoff to `hitl_check` |

## 5. Phase plan — deliverables and acceptance criteria

Every phase ends with: `npm run lint && npm run typecheck && npm run build` clean,
TODO ticked, CHANGELOG appended, CONTEXT §State updated.

### Phase 0 — Scaffold & foundation
Deliverables: git repo; Next app (TS strict, Tailwind v4, App Router, `src/`,
standalone); `docker-compose.yml` (panel:3100, pgvector/pg16 on host 5433);
Drizzle schema incl. `run_events` + HNSW index, first migration, owner seed;
`src/server/env.ts` zod loader that fails loudly; `tokens.css` both themes +
self-hosted fonts; UI primitives (Button, IconButton, Panel, Readout, Dot, Toast,
Modal, SegmentedSwitch, HoldToConfirm, Skeleton, LiveGlyph) with every state;
owner login (argon2, iron-session, 5-fails/15-min limiter, no registration);
splash boot ≤1.6 s, skippable, once per session.
Accept: `docker compose up` healthy; migration applies to an empty DB; login
rejects wrong password and rate-limits; primitives render in both themes at
375 px and 1440 px; `prefers-reduced-motion` kills the splash.

### Phase 1 — Shell & chat core
Deliverables: app grid (topbar + collapsible sidebars + Mission panel shell);
typed `lhos/client.ts` (zod-parsed envelope, 5xx-only GET retry, latency log,
retryable-error classifier) + `/api/lhos/*` proxies; connection dot driven by
`/api/capabilities`; chat CRUD + message persistence; prompt bar; SSE streaming
render with markdown + code blocks; Anthropic adapter (stream, tools, usage,
prompt caching) then OpenAI and OpenRouter; agent loop v1 per
`docs/skills/skill-agent-loop.md` with persisted steps, step chips, inline
images, cancel; usage metering + live ticker.
Accept: a real prompt drives a real LHOS tool call and renders its result; refresh
mid-run reattaches via `Last-Event-ID` with no duplicated tokens; cancel stops
both streams within 2 s; `usage_events` cost matches a hand-calculated figure;
step chips show server `ms`.

### Phase 2 — HITL: approvals, takeover, computer panel
Deliverables: policy checkpoints + approvals card + `confirm` proxy (ADR-02);
`ask`/`takeover` answering via host bridge; VNC embed with watch /
hold-to-confirm take-control / expand; `ask_user` question card; auto-expand on
takeover; toasts + Chrome notifications + WebAudio sound pack; upload
(drag-drop + paste) → `files` → vision models.
Accept: a `workflow_run` with a `confirm` step pauses, shows in the card, and
resumes after approval from the panel; an approval decided on the LHOS page
reconciles to `decided_via='lhos-page'`; takeover pops the computer panel; the
agent can never approve its own checkpoint (verified by test).

### Phase 3 — Settings suite
Settings modal + schema-validated store; Models tab (encrypted keys, last-4,
enable/disable, default/fallback, pricing override); Usage view (sortable, CSV,
budget warning); Agent tab; Approvals & Takeover policy; Appearance;
Notifications & Sound; Data.
Accept: a saved vendor key round-trips encrypted (ciphertext in DB, last-4 in
UI, no reveal endpoint); invalid settings are rejected by JSON Schema with a
readable error; checkpoint patterns can only be made stricter, never looser.

### Phase 4 — Automation & connectors
Schedules tab over LHOS `schedule_*` + panel-native prompt schedules; trigger
URLs and signed inbound webhooks; Composio connect flow + namespaced tool
surfacing; Pipedream in/out; custom connectors via LHOS vault intake; memory
extraction + pgvector recall + Memories viewer.
Accept: a schedule created in the panel appears in `schedule_list`; a signed
webhook fires a run and an unsigned one is rejected; recall returns relevant
facts and the viewer can delete them.

### Phase 5 — Manage mode
Host bridge with a fixed action→command allowlist + `audit` rows; Overview
(service cards, restart, desktop sleep/wake/new, host stats + sparklines);
activity feed + report browser + generate-now; persist file manager + snapshots
(prune locked off with its reason); system settings (masked config, rotate-auth,
lock-ip, panel ops); journalctl viewer over SSE.
Accept: no free-form shell reaches the bridge (test asserts rejection); every
mutating action writes an audit row; restarting a unit reflects within one poll;
protected persist paths are listed but not downloadable.

### Phase 6 — Polish & ship
Command palette, keyboard map, shortcut sheet; motion/perf/a11y passes;
Dockerfile + compose + Caddy block; nightly `pg_dump`; deploy; smoke-test every
Phase 1–5 flow in production; rotate LHOS tokens and re-sync env.
Accept: Lighthouse a11y ≥95 and AA contrast on both themes; SSE verified through
Caddy; a restored `pg_dump` boots; post-rotation the panel reconnects.

## 6. Engineering standards (cross-cutting)

- **Validation at every boundary.** zod for env, LHOS responses, API route bodies
  and SSE payloads. A malformed upstream response is a typed error, never `any`.
- **Errors are structured.** `{code, message, retryable, cause}`; API routes map
  them to status codes; the UI renders cause-specific states (waking up, rate
  limited, budget exceeded) rather than a generic toast.
- **Logging.** One server logger; every LHOS call logs `{tool, ms, ok}`; never log
  secret values, tokens, or full tool payloads.
- **Testing.** Vitest for pricing math, the retryable classifier, approval policy
  matching, the manage allowlist, and crypto round-trip. Playwright smoke for
  login → chat → tool call → approval. Tests must not hit live LHOS; the client is
  injected.
- **No duplicated patterns.** Second use of anything extracts into
  `src/components/ui/*` (rule 00).
- **Commits.** Conventional, one feature each; `.env.local`, `node_modules`,
  uploads never committed.

## 7. Deployment plan

1. Build image locally; `docker compose up -d`; verify both healthchecks.
2. Back up `/etc/caddy/Caddyfile` with a timestamp.
3. Add the `panel.hostx.h22t.com` block with `reverse_proxy localhost:3100` and
   `flush_interval -1`.
4. `caddy validate --config /etc/caddy/Caddyfile`, then `systemctl reload caddy`.
5. Verify all three hosts still answer (`panel.`, `mcp.`, `vnc.`).
6. Smoke-test: login, splash, chat with a live tool call, approval round-trip,
   VNC iframe cookie, usage ticker, Manage overview.
7. `manage.sh rotate-auth` → `scripts/sync-env.sh` → restart panel → re-verify.
8. Rollback: restore the Caddyfile backup, reload, `docker compose down`.

## 8. Owner inputs required

- **Vendor API key** for at least one model (Anthropic recommended first — the
  adapter order starts there). Without it Phase 1's loop has no brain. Entered in
  Settings → Models (encrypted at rest) or `.env.local`.
- **Permission to touch the host Caddyfile** (Phase 6, step 2–5 above).
- **Owner email** for the login account (`OWNER_EMAIL`), password set via
  `npm run owner:set-password` so it never passes through chat.
