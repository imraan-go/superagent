# Changelog

All notable changes to tj-lhos-panel. Newest first. Format:
`## YYYY-MM-DD — summary` + bullets. Update EVERY work session (rule 40-workflow).

## 2026-10-15 — Wave 2: ops + loose ends
- LHOS approve/reject: `decideApproval` timeout 15 s -> 45 s; on a timeout it
  re-reads `/api/approvals` and reports success if the record is gone
  (`src/server/lhos/decide.ts`, unit-tested).
- Mission "Spend today": warn banner at >= `usage.warnAtPct` % of
  `usage.dailyBudgetUsd`, danger banner when exceeded. Computed server-side
  (`budget` field added to the `/api/usage/live` summary; budget 0 = none).
- Retention: `data.retentionDays` enforced once per 24 h from the in-process
  scheduler (`automation/retention.ts`): deletes non-pinned chats idle longer
  than N days (messages/runs/steps cascade; usage_events keep rows with
  chat_id NULL; chat uploads and orphaned blobs removed), audit `retention.prune`.
- Theme: root layout reads `appearance.theme` per request and seeds ThemeScript,
  which refreshes the localStorage mirror before paint (server value wins).
- Pace: with no saved `agent.pace`, Settings reads LHOS's live pace from
  `/api/capabilities` (60 s cache, 3 s timeout, read-only; never set_pace).
- Backups: `scripts/backup.sh` (pg_dump via `panel-db` + uploads tarball, 14-day
  prune, `--db-only`) and `deploy/tj-lhos-panel-backup.{service,timer}` (03:30
  nightly). NOT installed on the host.
- Next 16: `src/middleware.ts` renamed to `src/proxy.ts` (`proxy` export);
  behaviour unchanged (public `/api/webhooks`, same-site CSRF guard).
## 2026-10-15 — Command palette + keyboard map (Phase 6)
- ⌘K / Ctrl+K opens a combobox command palette (fuzzy search, grouped: Actions,
  Navigate, Recent chats from the `["chats"]` query, Settings tabs, Manage
  sections). Settings deep-links via a `fd:open-settings` event and a
  `requestedTab` prop; Manage sections via `requestManageSection()`.
- Global shortcuts through the new `useHotkeys` hook (`src/lib/hotkeys.ts`,
  unit-tested): ⌘J new chat, ⌘/ focus prompt, `?` shortcut sheet, `g a` / `g m`
  / `g w`. Bare keys and sequences are ignored in text fields and while a
  dialog is open; Esc is the native `<dialog>` close (topmost first).
- HITL cards are focusable: `R` rejects, `Enter` sends the typed answer, and
  approve is press-and-hold `A` via `HoldToConfirm`'s new `holdKey`/`keyScope`
  (same hold duration; early release or repeat never approves).
## 2026-10-15 — Polish: a11y, motion, perf, responsive (Phase 6)
- Lazy chunks with content-shaped skeletons: Manage sections, Computer and
  Library tabs, markdown (react-markdown/gfm), each Settings tab (Appearance
  stays static for AppearanceSync).
- Responsive: below 1100px the history collapses to an icon rail and the
  Mission rail becomes a drawer behind a "Mission" toggle (shows the waiting
  count; "Open computer" opens it); below 820px a topbar menu opens the history
  drawer; Manage nav becomes a scroll strip; 390px reaches chat, approvals and
  Computer. The waiting badge shows in Manage and deep-links `/manage?section=hitl`.
- A11y: skip link, `#main` landmarks, labelled asides, polite run-state live
  region (transitions only), assertive live region for new approvals. Tokens
  fixed to AA numerically: text-3 both themes, light signal/amber/ok.
- Motion: mode crossfade and a pulsing edge-light on active runs, both off
  under reduced motion (system or Settings; "off" re-enables).
## 2026-10-15 — Security hardening before go-live
- Agent loop enforces the tool allowlist server-side and refuses vault, trigger, schedule and approval tools.
- Approval checkpoints match canonical tool names, and any http-style tool that writes is gated.
- SSRF guard on MCP, Pipedream and custom-connector URLs, with no redirects followed.
- Tool results, files and memories are wrapped as untrusted data; third-party tool descriptions are sanitised.
- Signed URLs and bearer values are redacted from model context, audit rows and logs.
- Production CSP and HSTS headers; login and webhook limiters use the proxy-appended IP; limiter memory is bounded.
- Rate limits on runs, key tests, host actions and exports.
- See docs/SECURITY_REVIEW.md; tests in tests/unit/security.test.ts.

## 2026-10-15 — Manage mode (Phase 5)
- `/manage` is now the full admin dashboard behind a left rail: Overview (9
  service cards with hold-to-confirm restart / caddy reload, desktop card with
  Sleep / Wake / typed-confirm New desktop as polled bridge jobs, host stats
  every 5 s with warn >= 80 / crit >= 90 tones and 30-minute client-side
  sparklines), Activity & reports (filterable, paged LHOS events; reports
  browser + Generate now), Persistent data (`~/persist` browser, 1-hour signed
  download links), Snapshots (read-only), Schedules & maintenance, System
  (masked config, ROTATE-gated token rotation, audit log), Logs (per-unit
  journal, SSE follow every 2 s, grep, auto-scroll) and a read-only HITL inbox.
- `/api/manage/*` routes (all `ownerRoute`, zod at the boundary, same-origin on
  mutations). Host mutations are audited by `bridge.ts`; LHOS mutations
  (schedules, maintenance, report generation, share links) by
  `src/server/manage/ops.ts`. Signed download URLs are never stored in `audit`.
- Safety: protected paths (`rdp_pass`, `.sync-stamp`, anything under
  `chrome-cdp`) are listed but refused by the server for browse and download;
  `snapshot_prune` is never called, the snapshot-prune schedule is locked server
  side, and the maintenance run enum only allows `fs_prune`.
- Pure logic in `src/lib/manage/*` with vitest coverage (sparkline buffer,
  protected paths + `ls` parsing, log-follow de-duplication, thresholds).
- Not built: DB backup-now (needs host access the bridge lacks); host-mirror
  size/last-sync for ~/persist (not exposed by the bridge); lock-ip form.
- Tests: `crypto.test.ts` now sets `BRIDGE_TOKEN` (the env loader requires it
  since the bridge landed).
- Dev note: in a linked worktree with a symlinked `node_modules`, run
  `next dev --webpack` (Turbopack refuses symlinks leaving the project root).
## 2026-10-15 — Computer panel (VNC) + file/image uploads
- Computer tab: live-view iframe with Watch overlay, Take control (600 ms hold,
  amber frame, LIVE CONTROL timer, Esc/Release, audit rows `computer.takeover.*`),
  Expand as a Motion layout animation of the same iframe (no reconnect), "Connect
  computer view" sign-in popup, iframe kept mounted while hidden and unmounted
  after 10 idle minutes, Wake button (`POST /api/computer/wake` ->
  `bridge.desktopAction('wake')`, polled via `GET /api/computer/jobs/[id]`).
  `GET /api/computer/viewer` exposes the viewer URL and probes embeddability.
  FINDING: the viewer sends `X-Frame-Options: DENY`, so browsers refuse to frame
  it; the panel shows a deep-link card until the viewer allows the panel origin.
- `lhos:open-computer` event and `request_takeover` steps switch to the tab and expand.
- Uploads: `POST /api/uploads` (20 MB, extension allowlist + magic-byte check,
  sha256 dedupe, stored under `UPLOAD_DIR`, images re-encoded with sharp, now a
  dependency), `GET /api/uploads/[id]` (auth, nosniff, CSP, attachment for
  non-images), `GET /api/chats/[id]/files`. Drag-drop, paste and `+` menu in the
  prompt bar; attachment chips/thumbnails in the transcript; new `file` message part.
- Agent: image attachments and tool screenshots go to vision models as image
  blocks (newest 3 kept per call); other files become text references (small
  text files inlined). Tool screenshots are saved to `files` (origin=tool).
- Library tab: grid of this chat's files with lightbox.
## 2026-10-15 — Settings suite; Phase 3 complete
- Settings store (`src/server/settings/store.ts`, zod mirror in `src/lib/settings.ts`
  kept in lockstep with `config/settings.schema.json`, which gains `data`,
  `models` and `usage.archivedAt`). `GET /api/settings`, `GET|PUT
  /api/settings/<section>` (body = the section JSON, defaults applied; PUT
  merges a partial patch). Approvals can only get stricter (defaults re-added
  server-side).
- Models: write-only vendor keys (`PUT|DELETE /api/settings/keys/<vendor>`,
  sealed, last4 only, `POST …/test` hits a free metadata endpoint),
  enable/disable + price overrides + default/fallback (`/api/settings/models`).
  `/api/models` and new-chat default honour overrides and stored keys.
- Usage tab: grouped/sortable table, date range, totals, daily budget meter +
  warning; `/api/usage/report`, `/api/usage/export` (CSV).
- Agent loop reads Settings per run: maxSteps, maxCostUsdPerRun, tool
  allowlist, owner system prompt (appended to base rules), checkpoint
  patterns (bare verbs match whole words). Pace change calls LHOS `set_pace`
  (ADR-08 mapping).
- Appearance (reduced motion, density via `<html data-*>`), Notifications &
  Sound, Data (chat JSON export `/api/data/export`, retention days), Danger
  zone (archive usage mark, sign out everywhere via session epoch).
## 2026-10-15 — Phase 4: automation & connectors
- **Schedules** (Settings → Schedules): CRUD/enable/run-now over LHOS `schedule_*`
  (LHOS = source of truth, mirrored to `schedules`); `snapshot-prune` is
  protected (cannot be run/enabled/deleted from the panel). Panel-native
  scheduled prompts (cron UTC + prompt + model) run by an in-process scheduler
  started once from `src/instrumentation.ts` (tiny cron parser, no new deps);
  each schedule reuses a dedicated chat.
- **Webhooks** (Settings → Triggers & Webhooks): sealed per-hook secret shown
  once; public `POST /api/webhooks/<id>` verifies
  `x-panel-signature: sha256=HMAC(secret, "<ts>.<rawBody>")` + `x-panel-timestamp`
  (±5 min), replay memory, per-hook/IP rate limits, 256 KB cap. Targets: agent
  prompt (payload wrapped as `<untrusted_payload>` data) or LHOS
  `workflow_run_saved` (payload deliberately NOT passed to workflows: injection
  risk). Unattended runs are budget-guarded: one at a time, refused (logged +
  `audit`) once today's spend >= `usage.dailyBudgetUsd` (default $10). Trigger
  URLs (token-bearing) are UI-only, never in model context. Middleware: `/api/webhooks` is public by path; owner
  management lives at `/api/automation/webhooks`. LHOS `trigger_url` links listed.
- **Connectors** (Settings → Connectors): Composio v3 REST (key from env or sealed
  `composio` secret; apps, hosted OAuth connect, disconnect; actions exposed as
  `composio__<app>__<action>`), Pipedream (`pipedream__emit`, always approval-gated;
  optional workflow list), custom REST via LHOS `connector_save` + vault intake
  link, remote MCP servers over minimal Streamable HTTP JSON-RPC
  (`mcp__<name>__<tool>`), LHOS MCP as read-only built-in. Loop routes namespaced
  tools server-side with the same approval policy.
- **Memories**: post-run extraction (role `memory-extraction`; skipped without a
  key), OpenAI `text-embedding-3-small` or local hashed fallback (column is NOT
  NULL), cosine > 0.92 dedupe, recall topK (`agent.memoryRecallTopK`, default 8)
  into the system prompt; viewer with search/add/edit/delete.
- Verified live: schedule_list/workflow_list/trigger_url, LHOS schedule
  create→pause→delete, panel schedule run (mock/echo), signed webhook → prompt run
  (unsigned/bad/stale/oversize/replay rejected), LHOS MCP tools/list (100 tools).
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
