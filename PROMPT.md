# Kickoff prompt for Cursor

Paste this as your first message (attach your Grok screenshots to the same message):

---

Read README.md, docs/CONTEXT.md, TODO.md and the rules in .cursor/rules/ before
doing anything. This repo is a docs-first workspace: all architecture, API, design
and integration decisions are already made and documented — follow them, don't
re-decide.

Start executing **TODO.md Phase 0** top to bottom:
scaffold the Next.js 15 app (TS strict, Tailwind v4, App Router, src dir,
standalone output) in this folder, set up docker-compose with Postgres+pgvector and
the Drizzle schema from docs/ARCHITECTURE.md, run `bash scripts/sync-env.sh` for
env, then build the design tokens and UI primitives from docs/DESIGN_SYSTEM.md —
including the LiveGlyph reactive loader — then owner-only login with the splash
boot sequence.

The screenshots I attached are Grok's UI: use them ONLY for layout familiarity
(left chat sidebar, center chat, right detail panel). The visual identity must be
our own "Flight Deck" design system (docs/DESIGN_SYSTEM.md) — noticeably different
and better, not a re-skin.

Integration facts (tokens come from .env.local via scripts/sync-env.sh — never ask
me to paste secrets, never hardcode them):
- LHOS REST: https://mcp.hostx.h22t.com/api/* (Bearer LHOS_MCP_TOKEN) — docs/API_REFERENCE.md
- LHOS MCP: https://mcp.hostx.h22t.com/mcp (same bearer) — docs/MCP_REFERENCE.md
- VNC viewer: https://vnc.hostx.h22t.com/ — docs/skills/skill-vnc-embed.md
- E2B API (Manage mode): http://hostx.h22t.com:3000 (X-API-KEY)

Work rules: after each completed TODO item run lint+typecheck, tick it in TODO.md,
and append to CHANGELOG.md. When you finish Phase 0, stop and show me the login +
splash + empty shell in the browser before starting Phase 1.

---

## Tips
- Keep one Cursor chat per phase; start each new chat with: "Read docs/CONTEXT.md,
  TODO.md and CHANGELOG.md, then continue from the current phase."
- If Cursor invents an endpoint or arg shape, point it to `GET /api/tools` (live
  schemas) and docs/API_REFERENCE.md.
- Before first deploy: add the Caddy block from docs/ARCHITECTURE.md §Docker on the
  host, then rotate LHOS tokens and re-run scripts/sync-env.sh.
