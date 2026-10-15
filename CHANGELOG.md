# Changelog

All notable changes to tj-lhos-panel. Newest first. Format:
`## YYYY-MM-DD — summary` + bullets. Update EVERY work session (rule 40-workflow).

## 2026-10-15 — HITL: approvals, questions, takeover, notifications + sound
- Panel checkpoints now pause with saved resume state (on the `approval` run
  step) and **resume** after an owner decision: approve runs the call then
  re-gates the rest of the turn; reject tells the model and skips the rest.
  SSE seq continues across segments; superseded `paused_approval` terminals
  are dropped on replay. A new user turn expires a pending checkpoint.
- `GET /api/approvals` merges panel checkpoints, LHOS records and bridge
  `/hitl`; mirrors LHOS ids and reconciles vanished ones
  (`decided_via` lhos-page / desktop). `POST /api/approvals/{uuid|8hex}`
  decides either kind; new `POST /api/hitl/{id}/answer|done` (bridge) refuse
  `confirm` records (409). All owner-session + same-origin; audited.
- Policy: writing `http_request` (POST/PUT/PATCH/DELETE) checkpoints.
- Mission tab "Waiting on you" panel (hold-to-approve, reject, inline answer,
  Open computer → `lhos:open-computer` event, Done); topbar badge; app-wide
  watcher → toast + sound + Chrome notification (lazy permission).
- `useSound()` WebAudio cues (send/done/approval/error/takeover), prefs from
  `/api/settings/{sound,notifications}` with schema defaults.

## 2026-10-15 — Live spend ticker; Phase 1 complete
- `/api/usage/live` (SSE, owner session): pushes today's totals — and one
  chat's when `?chatId=` — on connect, after every `usage_events` insert
  (in-process bus `src/server/usage/live.ts`, `notifyUsage()` from the loop,
  250 ms debounce), and at midnight rollover; 15 s heartbeats.
- Mission tab opens with **Spend today**: cost (signal readout), tokens in/out,
  "this chat" cost and model-call count; live dot reflects the stream.
- Verified live: 401 without session; exact totals delta on an inserted row;
  a real mock-model run pushed the new totals 1.2 s after send.
- Note: authenticated e2e tests skip unless `E2E_OWNER_EMAIL`/`E2E_OWNER_PASSWORD`
  are exported in the shell (kept out of `.env.local` on purpose).

## 2026-10-15 — Manage nav opens a real workspace
- The Agent / Manage switch now routes. Manage goes to `/manage` (amber accent);
  Agent returns to the chat workspace. The chat history rail hides while Manage
  is open.
- `/manage` is a read-only system view: Overview (desktop, pace, RDP, pending
  HITL), Activity (latest tool calls), and today's report. Restart, sleep/wake
  and logs stay out until the host bridge — a control that cannot act is not
  shown.

## 2026-10-15 — Design pass from Grok Bot refs + chat workspace
- Adopted the structural answers from the owner-supplied Grok Bot screenshots
  (`docs/reference/grok-0*.png`) without copying the look: three columns always
  on (landing included), type-to-start pill prompt, sidebar status lines +
  Today/Yesterday grouping, Settings at the rail foot, right rail tabbed
  Mission | Library | Computer, sleeping-computer card with a single Wake.
- **SettingRow** primitive (label + muted description + right-aligned control)
  and a Settings modal shell — Appearance (theme) is live; other tabs are
  honest placeholders so Phase 3 fills them without a redesign.
- Theme toggle in the topbar swaps via `data-theme` (no hydration flicker).
- Landing prompt creates the chat on first send so the owner types once.
- ADR-06 default tool allowlist wired into the loop (RDP / raw click-family
  stay opt-in). `filterTools` is unit-tested.
- Rejected Grok's right-aligned user bubbles — transcript stays left-aligned
  on the 760px measure with a role gutter.

## 2026-10-15 — Phase 1a: LHOS gateway, `/api/lhos/*` proxies, live connection dot
- **LHOS client** (`src/server/lhos/*`, ADR-01 — REST, not the MCP SDK): typed
  gateway over `POST /api/tools/<name>` with zod schemas for every wire shape,
  120 s tool / 15 s read timeouts, and caller-abort propagation. GET requests
  retry on transport and 5xx failures; **tool calls are never retried** because
  they are not idempotent — a retried `desktop_click` clicks twice.
- **Retryable classifier** (`retryable.ts`): separates "the desktop is waking up"
  (30 s fixed backoff) from transient transport errors (exponential, capped at
  8 s) from fatal 4xx. Pure and dependency-free so it is unit-testable.
- **Tool catalogue cache**: `GET /api/tools` is a 43 KB unpaginated document
  fetched on nearly every run, so it is cached in-process for 5 minutes with
  in-flight deduplication and stale-on-error fallback.
- **Proxies**: `/api/lhos/capabilities|tools|events|report` and `/api/approvals`,
  all behind a new `ownerRoute` wrapper that verifies the sealed session (the
  real authorisation boundary — middleware only sees that a cookie exists).
  Status endpoints return `200 {reachable:false}` rather than an error status so
  a polling UI can show "waking"/"offline" without treating it as a failure.
- **Approve/reject proxy** (`POST /api/approvals/[id]`): owner-session only,
  `confirm` kind only, records `decided_via='panel'`. `APPROVE_TOKEN` stays
  server-side and never appears in a response or an error message.
- **Connection dot**: live against `/api/lhos/capabilities` every 20 s via
  TanStack Query, distinguishing offline / waking / desktop-asleep / live —
  verified Live against the real sandbox `injo6euds4…`.
- **Logger** (`src/server/lib/logger.ts`): JSON lines, level-gated, with key
  redaction so a stray `token`/`password` field can never reach the logs.
- **Tests**: 20 new unit tests (classifier + wire schemas built from captured
  live payloads), 3 new e2e (clean hydration, dot resolves, mode switch), and an
  opt-in live contract suite — `npm run test:smoke` exercises a real screenshot
  and a real tool call against the agent computer. 28 unit + 8 e2e + 5 smoke green.
- Fixed: `resultText`/`resultImages` took the whole envelope while naming the
  parameter `result`; they now take the block array and compose.

## 2026-10-15 — Phase 0 complete: scaffold, design system, database, owner auth
- **App**: Next 16.4.1 (App Router, TS strict + `noUncheckedIndexedAccess`,
  Tailwind v4 via PostCSS, standalone output), self-hosted Space Grotesk /
  Instrument Sans / JetBrains Mono, security headers, non-root Dockerfile.
- **Design system**: `src/styles/tokens.css` with both themes, Manage-mode amber
  remap, reduced-motion overrides. Eleven primitives in `src/components/ui/*`
  (Button, IconButton, Panel, Readout, Dot, LiveGlyph, HoldToConfirm, Skeleton,
  SegmentedSwitch, Modal, Toast) — every variant/state verified in both themes on
  the `/dev/primitives` proof sheet (dev-only, 404s in production).
- **Database**: pgvector/pg16 on host port 5433, 17 tables migrated, HNSW index on
  `memories.embedding`, `run_events` added for SSE resume.
- **Auth**: owner-only login (argon2id via `@node-rs/argon2`, iron-session cookie
  HttpOnly/SameSite=Lax/30-day), Postgres-backed 5-failures-per-15-minutes limiter
  that survives restarts, host-compared same-site CSRF guard, `/api/health`.
  Verified: bad password 401, 6th attempt 429 (correct password still blocked),
  cross-origin POST 403, unauthenticated routes redirect/401.
- **Tests**: Vitest (8 crypto tests — caught a real off-by-one that rejected an
  empty sealed value) + Playwright (5 auth e2e). `lint`, `typecheck`, `build` clean.
- Decisions recorded: Next 16 over the rule's Next 15; `cacheComponents` disabled
  (the app is almost entirely dynamic); Tailwind via PostCSS rather than the
  Turbopack CSS loader, which would also intercept `*.module.css`.

## 2026-10-15 — Live-system probe + production implementation plan
- Probed the running LHOS/E2B host before writing any code: 100 tools,
  capabilities/events/report/approvals all 200, E2B health 200, VNC 302→sign-in,
  toolchain Node 22 / Docker 29 / Compose v5.
- Added `docs/IMPLEMENTATION_PLAN.md`: verified baseline, ground-truth doc
  corrections, 8 ADRs, 10-item risk register, per-phase acceptance criteria,
  engineering standards, deploy + rollback plan.
- Corrected docs against reality: `POST /api/tools/<name>` returns an
  `{ok,tool,ms,result[]}` envelope (not the raw result); `/api/approvals` returns
  `{id,kind,prompt,created}` for **all** pending HITL kinds; documented the exact
  approve/reject route and the separate `ask`/`takeover` answer channel;
  `set_pace` real signature; verified `/api/capabilities` + `/api/events` shapes.
- Architecture additions: `run_events` table for SSE `Last-Event-ID` resume,
  `approvals.kind`, host Postgres port 5433 (5432 is E2B's), Caddy
  `flush_interval -1` for SSE, single-instance constraint recorded.
- TODO/CONTEXT updated with the above; no application code yet.

## 2026-10-15 — Project workspace created (pre-code)
- Cursor-ready docs/context scaffold authored by Claude (session
  01AVDa2rQcsQKX6QmJQErbBb) on the LHOS host:
  `.cursor/rules/` (project, design, api-mcp, security, workflow),
  `docs/` (CONTEXT, ARCHITECTURE, API_REFERENCE, MCP_REFERENCE — verified against
  the live server's 100 tools —, DESIGN_SYSTEM "Flight Deck", INTEGRATIONS,
  MANAGE_TAB), 4 skills, `config/models.json` + `settings.schema.json`,
  `.env.example` + `scripts/sync-env.sh`, TODO (6 phases), FUTURE_SCOPE, PROMPT.md.
- Decisions locked: Next.js 15 FE+BE, Drizzle + Postgres16 + pgvector, SSE,
  Tailwind v4 + tokens, owner-only auth, Docker + Caddy at panel.hostx.h22t.com,
  approvals human-only, no anti-detection features.
- No application code yet. Next: TODO Phase 0.
