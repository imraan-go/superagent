# Changelog

All notable changes to tj-lhos-panel. Newest first. Format:
`## YYYY-MM-DD — summary` + bullets. Update EVERY work session (rule 40-workflow).

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
