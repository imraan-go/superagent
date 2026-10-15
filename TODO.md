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

## ➤ Phase 1 — Shell & chat core
- [ ] App grid: topbar (Agent/Manage switch, connection dot), left sidebar
      (history groups, pinned, search, settings at bottom), right Mission panel shell
- [ ] LHOS client (`src/server/lhos/client.ts`, REST per ADR-01 — parse the
      `{ok,tool,ms,result[]}` envelope) + `/api/lhos/*` proxies; connection
      dot live against `/api/capabilities`; retryable-error classifier ("waking up")
- [ ] Chat CRUD + message persistence; prompt bar (model picker, pace toggle,
      attach, LiveGlyph); streaming SSE render (markdown, code blocks)
- [ ] Anthropic adapter first (stream + tools + usage) → then OpenAI, OpenRouter
- [ ] Agent loop v1 per docs/skills/skill-agent-loop.md (tools, steps persisted,
      step chips UI, images in chat, cancel)
- [ ] Usage metering + right-sidebar live token/cost ticker (skill-token-metering)

## Phase 2 — HITL: approvals, takeover, computer panel
- [ ] Approval checkpoints + approvals card + `confirm` proxy
      (`POST /approvals/{id}/approve|reject?token=`, ADR-02) (skill-approvals-hitl)
- [ ] Computer panel: VNC iframe watch/take-control/expand (skill-vnc-embed)
- [ ] `ask_user` question card; `request_takeover` auto-expand flow — answered via
      host bridge `manage.sh answer|done`, **not** the approvals route (ADR-02)
- [ ] Notifications: toasts + Chrome notifications + sound pack (useSound)
- [ ] File/image upload (drag-drop + paste) → files table → vision models + LHOS

## Phase 3 — Settings suite
- [ ] Settings modal w/ left tabs; settings store (DB + schema validation)
- [ ] Models tab (keys encrypted, enable/disable, default, pricing override)
- [ ] Usage view (sortable table, CSV export, daily budget warn)
- [ ] Agent tab (system prompt, max steps/cost, tool allowlist, pace)
- [ ] Approvals & takeover policy tab · Appearance · Notifications & Sound · Data

## Phase 4 — Automation & connectors
- [ ] Schedules tab ↔ LHOS schedule_* + panel-native scheduled prompts
- [ ] Trigger URLs + inbound webhooks (signed) → run workflow/agent prompt
- [ ] Composio connect flow + agent tool surfacing (INTEGRATIONS.md §4)
- [ ] Pipedream webhooks in/out (§5) · Custom connectors → LHOS vault intake
- [ ] Memories: extraction + pgvector recall + Memories viewer in Settings→Data

## Phase 5 — Manage mode
- [ ] Host bridge with allowlist (MANAGE_TAB.md §Host bridge) + audit table
- [ ] Overview: service cards + restart, desktop sleep/wake/new, host stats
- [ ] Activity feed + reports browser (rendered daily .md) + generate-now
- [ ] Persist file manager + snapshots (read-only prune) + schedules/maintenance
- [ ] System settings: masked config viewer, rotate-auth flow, lock-ip, panel ops
- [ ] Logs viewer (journalctl follow via SSE)

## Phase 6 — Polish & ship
- [ ] Command palette (⌘K), keyboard map, shortcut sheet (?)
- [ ] Motion pass (page transitions, mode-switch scanline, edge-light), perf pass
      (bundle, lazy sidebars), a11y pass (AA, focus, SR announcements)
- [ ] Dockerfile (standalone) + compose + Caddy block `panel.hostx.h22t.com`
      (**`flush_interval -1` or SSE breaks**; backup + `caddy validate` + reload,
      never restart — IMPLEMENTATION_PLAN §7);
      nightly pg_dump; deploy; smoke-test every Phase 1–5 flow in prod
- [ ] Rotate all LHOS tokens after first deploy (`manage.sh rotate-auth` + sync-env)
