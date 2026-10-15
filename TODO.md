# TODO — build order

> Tick items as done; current phase marker: ➤. Add discovered tasks under the right
> phase. Done = lint+typecheck pass, works in browser, CHANGELOG updated.
> **Per-phase deliverables + acceptance criteria: `docs/IMPLEMENTATION_PLAN.md` §5.**

## ✅ Phase 0 — Scaffold & foundation (done 2026-10-15)
- [x] `git init` + `.gitignore` audit + initial commit (repo was never initialized)
- [x] `npx create-next-app@latest` → **Next 16.4.1** (TS strict, Tailwind v4,
      App Router, src dir, standalone)
- [x] Drizzle + pgvector: docker-compose (panel:3100 + pgvector/pg16 on **host 5433**,
      ADR-03), schema from ARCHITECTURE.md §Database **incl. `run_events`** (ADR-05),
      first migration (17 tables + HNSW index), owner account via `owner:set-password`
- [x] `scripts/sync-env.sh` run + env loader with zod validation (`src/server/env.ts`)
- [x] Vitest + Playwright config (standards in IMPLEMENTATION_PLAN §6);
      8 unit tests (crypto) + 5 e2e (auth) green
- [x] Design tokens → `src/styles/tokens.css` (both themes) + fonts via next/font
- [x] UI primitives: Button, IconButton, Panel, Readout, Dot, Toast, Modal,
      SegmentedSwitch, HoldToConfirm, Skeleton, LiveGlyph (all states) —
      proof sheet at `/dev/primitives`
- [x] Owner auth: login page + iron-session + argon2id + 5/15min rate limit +
      `owner:set-password` script + same-site CSRF guard
- [x] Splash/boot animation after login (skippable, ≤1.6 s, once per session)
- [x] Dockerfile (standalone, non-root) + `/api/health` for the compose healthcheck

## ✅ Phase 1 — Shell & chat core (done 2026-10-15)
- [x] App grid: topbar (Agent/Manage switch, connection dot, theme), left sidebar
      (history grouped by time, pinned, search, settings at bottom), right rail
      tabbed Mission | Library | Computer — landing has the same three columns
      and a type-to-start prompt bar
- [x] LHOS client (`src/server/lhos/client.ts`, REST per ADR-01 — parse the
      `{ok,tool,ms,result[]}` envelope) + `/api/lhos/*` proxies; connection
      dot live against `/api/capabilities`; retryable-error classifier ("waking up")
      — + 5-min tool-catalogue cache, owner-only `ownerRoute` wrapper, and an
      opt-in live contract suite (`npm run test:smoke`)
- [x] Chat CRUD + message persistence + deriveTitle; prompt bar (pill, `+` menu,
      model picker); streaming SSE render (markdown, code, activity line)
- [x] ModelAdapter + mock (no key) + Anthropic + OpenAI/OpenRouter adapters
- [x] Agent loop v1 per docs/skills/skill-agent-loop.md (tools, steps persisted,
      step chips UI, cancel, Last-Event-ID resume, ADR-06 default allowlist)
- [x] Usage metering + right-sidebar live token/cost ticker (skill-token-metering)
      — `/api/usage/live` SSE (today + this chat), pushed on every usage row,
      midnight rollover; "Spend today" panel tops the Mission tab

## ➤ Phase 2 — HITL: approvals, takeover, computer panel
- [x] Approval checkpoints + approvals card + `confirm` proxy
      (`POST /approvals/{id}/approve|reject?token=`, ADR-02) (skill-approvals-hitl)
- [x] Computer panel: VNC iframe watch/take-control/expand (skill-vnc-embed)
      (viewer sends X-Frame-Options: DENY: embed blocked until server allows it)
- [ ] `ask_user` question card; `request_takeover` auto-expand flow — answered via
      host bridge `manage.sh answer|done`, **not** the approvals route (ADR-02)
- [ ] Notifications: toasts + Chrome notifications + sound pack (useSound)
- [x] File/image upload (drag-drop + paste) → files table → vision models
      (pushing files to the agent computer via LHOS not done)
- [ ] Computer panel: VNC iframe watch/take-control/expand (skill-vnc-embed)
- [x] `ask_user` question card; `request_takeover` auto-expand flow — answered via
      host bridge `manage.sh answer|done`, **not** the approvals route (ADR-02)
- [x] Notifications: toasts + Chrome notifications + sound pack (useSound)
- [ ] File/image upload (drag-drop + paste) → files table → vision models + LHOS

## Phase 3 — Settings suite
- [x] Settings modal w/ left tabs; settings store (DB + schema validation)
- [x] Models tab (keys encrypted, enable/disable, default, pricing override)
- [x] Usage view (sortable table, CSV export, daily budget warn)
- [x] Agent tab (system prompt, max steps/cost, tool allowlist, pace)
- [x] Approvals & takeover policy tab · Appearance · Notifications & Sound · Data

## Phase 4 — Automation & connectors
- [x] Schedules tab ↔ LHOS schedule_* + panel-native scheduled prompts
- [x] Trigger URLs + inbound webhooks (signed) → run workflow/agent prompt
- [x] Composio connect flow + agent tool surfacing (INTEGRATIONS.md §4)
- [x] Pipedream webhooks in/out (§5) · Custom connectors → LHOS vault intake
- [x] Memories: extraction + pgvector recall + Memories viewer in Settings→Data
- [x] Remote MCP connectors (`mcp__<name>__<tool>`) + LHOS MCP built-in entry

## Phase 5 — Manage mode
- [x] Host bridge with allowlist (MANAGE_TAB.md §Host bridge) + audit table
- [x] Overview: service cards + restart, desktop sleep/wake/new, host stats
- [x] Activity feed + reports browser (rendered daily .md) + generate-now
- [x] Persist file manager + snapshots (read-only prune) + schedules/maintenance
- [x] System settings: masked config viewer, rotate-auth flow, audit log (lock-ip form and panel DB backup-now deferred: bridge has no endpoint)
- [x] Logs viewer (journalctl follow via SSE)

## Phase 6 — Polish & ship
- [x] Command palette (⌘K), keyboard map, shortcut sheet (?)
- [ ] Motion pass (page transitions, mode-switch scanline, edge-light), perf pass
      (bundle, lazy sidebars), a11y pass (AA, focus, SR announcements)
- [ ] Dockerfile (standalone) + compose + Caddy block `panel.hostx.h22t.com`
      (**`flush_interval -1` or SSE breaks**; backup + `caddy validate` + reload,
      never restart — IMPLEMENTATION_PLAN §7);
      nightly pg_dump; deploy; smoke-test every Phase 1–5 flow in prod
- [ ] Rotate all LHOS tokens after first deploy (`manage.sh rotate-auth` + sync-env)

## Wave 2 — ops & loose ends
- [x] LHOS reject timeout (45 s + pending re-check)
- [x] Budget banner in Mission "Spend today" (warn/over)
- [x] `data.retentionDays` daily prune job (audited)
- [x] Server-saved theme seeds ThemeScript
- [x] Settings pace reflects LHOS when never saved
- [x] `scripts/backup.sh` + `deploy/tj-lhos-panel-backup.{service,timer}` (install on host: copy to /etc/systemd/system, `systemctl enable --now tj-lhos-panel-backup.timer`)
- [x] `middleware.ts` -> `proxy.ts` (Next 16)
