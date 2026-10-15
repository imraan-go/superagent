# Architecture

## App shape
Single Next.js 15 app (App Router, TS strict), server components by default,
client components only where interactive. Deployed as Docker container
`tj-lhos-panel` + `postgres:16` with `pgvector` (docker-compose), reverse-proxied
by the host's existing Caddy at `panel.hostx.h22t.com` (same-site as the VNC domain
— required for the embedded VNC iframe cookie). Future: compose file is portable to
any server behind nginx/openresty; nothing binds to this VPS except env values.

```
src/
  app/
    (auth)/login/            # owner login + splash
    (app)/chat/[id]/         # Agent mode
    (app)/manage/            # Manage mode (E2B dashboard)
    api/
      auth/*                 # login/logout/session
      chat/*                 # create/list; POST message → SSE stream of run events
      runs/*                 # run detail, cancel, resume(approval)
      approvals/*            # list + owner-proxied approve/reject
      lhos/*                 # thin proxies: capabilities, events, report, tools meta
      usage/*                # usage query + SSE ticker
      uploads/*              # file/image upload, serve
      settings/*             # settings CRUD (schema-validated)
      schedules/* connectors/* webhooks/*   # settings subsystems
      manage/*               # systemd status/restart, stats, logs, persist files (SSH/local exec via LHOS run_command or host bridge)
  server/
    agent/   loop.ts planner.ts tools.ts approval.ts memory.ts
    models/  adapter.ts openai.ts anthropic.ts openrouter.ts pricing.ts
    lhos/    client.ts types.ts
    db/      schema.ts index.ts migrations/
    lib/     crypto.ts sse.ts ratelimit.ts audit.ts
  components/ui/             # reusable primitives (Button, Panel, Readout, …)
  components/chat|mission|manage|settings/
  styles/tokens.css globals.css
config/models.json settings.schema.json
```

## Database (Postgres 16 + pgvector, Drizzle)
- `users` (single row; email, pass_hash, totp_secret?, prefs jsonb)
- `chats` (id, title, pinned, created_at, archived)
- `messages` (chat_id, role, content jsonb[parts], model, created_at)
- `runs` (chat_id, status: running|paused_approval|done|error|cancelled, started/ended)
- `run_steps` (run_id, idx, type: think|tool|observe|approval|takeover|waiting,
  tool_name, args jsonb, result jsonb, images[], ms, ok)
- `run_events` (run_id, seq, type, data jsonb, ts) — append-only SSE event log,
  `seq` monotonic per run. Required for `Last-Event-ID` resume: steps alone can't
  reconstruct a token stream (IMPLEMENTATION_PLAN ADR-05). Unique (run_id, seq).
- `usage_events` (ts, vendor, model, chat_id, run_id, tokens_in, tokens_out,
  tokens_cached, cost_usd numeric(12,6), purpose) + daily matview for the ticker
- `approvals` (lhos_approval_id, kind: confirm|ask|takeover, run_id, prompt,
  status, answer, decided_at, decided_via: panel|lhos-page|desktop)
- `files` (sha256, name, mime, bytes, path, chat_id?, origin: upload|tool)
- `settings` (key, value jsonb, updated_at) — validated by config/settings.schema.json
- `secrets` (name, enc blob AES-256-GCM, last4, vendor, created_at)
- `connectors` (kind: composio|pipedream|custom, config jsonb, enabled)
- `schedules` (cron, workflow, enabled, last_run, next_run) — mirrors LHOS scheduler,
  LHOS is the source of truth; panel caches for UI
- `memories` (id, kind: fact|preference|project, text, embedding vector(1536),
  source_chat, created_at) + HNSW index

## Agent loop (server)
`POST /api/chat/:id/message` → creates `run`, streams SSE events:
`token` (model delta) · `step_start/step_end` · `image` · `usage` · `approval_required`
· `takeover_requested` · `done|error`.
Loop: build context (system prompt + settings + memories recall topK=8 + chat tail)
→ model with LHOS tool defs (from /api/tools, filtered by an allowlist in settings)
→ execute via MCP client → feed result back → repeat (max_steps from settings).
Approval policy: irreversible-action tool patterns (send/post/pay/delete/publish)
always checkpoint; plus LHOS `awaiting_approval` passthrough. Pause persists; resume
endpoint continues the loop. Cancel sets status and aborts in-flight call.
Memory: after each run, extract durable facts → upsert `memories` (dedupe by cosine).

## Realtime
- Chat/run: SSE per run (`/api/runs/:id/events`), resumable via `Last-Event-ID`
  — replay `run_events.seq > N` from Postgres, then attach to the live stream.
- Usage ticker + approval badge + service status: one multiplexed SSE
  (`/api/usage/live`) pushing every event or 5 s heartbeat.
- **Single instance only.** The run registry (abort controllers + live subscriber
  sets) is in-process module state; never run replicas (ADR-04).

## Docker / deploy
`docker-compose.yml`: `panel` (node:22-alpine multi-stage, standalone output),
`db` (pgvector/pgvector:pg16, volume `pgdata`). Healthchecks on both.
**Host port 5433 → db:5432** — 5432 is taken by E2B's `local-dev-postgres-1`
(ADR-03). In-container `DATABASE_URL` still uses `db:5432`.
Caddy site block (add to host Caddyfile):
```
panel.hostx.h22t.com {
  reverse_proxy localhost:3100 {
    flush_interval -1   # required: buffering would break SSE
  }
}
```
Env: see `.env.example`; real values via `scripts/sync-env.sh` + owner-entered keys.
Backups: nightly `pg_dump` to `/root/backups/` (cron in compose sidecar or host).

## Manage-mode host control
Service restart / stats / logs come from a tiny allowlisted host bridge:
`/api/manage/*` executes ONLY whitelisted commands (`systemctl status|restart <unit
from fixed list>`, `manage.sh status|url|sleep|wake|new-desktop`, `df`, `free`,
`journalctl -u <unit> -n 200`) via SSH to host or a mounted socket helper —
never arbitrary shell from the UI. Unit list + command map in `src/server/manage/allowlist.ts`.
