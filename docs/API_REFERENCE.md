# LHOS REST API Reference

Base: `env LHOS_BASE_URL` → `https://mcp.hostx.h22t.com`
Auth: `Authorization: Bearer ${LHOS_MCP_TOKEN}` on every request.
All responses JSON unless noted. Errors: non-2xx with `{"error": "..."}`.

> Verified against `/root/e2b-agent-vm/bin/mcp_server.py` (RestMW middleware), 2026-10-15.

## Endpoints

### GET /api/tools
Tool catalog. → `[{ name, description, input_schema }]` (100 tools; JSON-Schema args).
Cache 5 min server-side in the panel; used to render tool pickers and validate args.

### POST /api/tools/{name}
Execute one tool synchronously. Body = JSON arguments matching `input_schema`
(must be a JSON object, else 400). Response is an **envelope**, not the raw result:
```
{ ok: boolean, tool: string, ms: number, result: Block[] }
Block = {type:"text", text} | {type:"image", mime, data_b64} | {type:"json", data}
```
`ok` is the server's own failure heuristic over the first text block. Failures:
400 for unknown tool / arg validation, 500 otherwise, body `{ok:false, error}`.
Long operations: prefer tools' own `background`/async options (e.g. `run_command`
with `background:true`), poll via follow-up tools. Timeout client-side at 120 s.
Note `ask_user` / `request_takeover` block server-side up to 110 s and may answer
with `PENDING id=<8hex>` — hand off to `hitl_check`, don't re-ask.

### GET /api/capabilities
Facts snapshot. Verified shape:
```
{ desktop:{up, sandbox_id}, linux_browser:{devtools_running},
  rdp:{connected, profile, shared_drive, password_stored, profiles[]},
  api:{credentials[], connectors[]}, skills:[{name, site, params[], runs, ok}],
  windows_agents, pace:{mode, min_gap_s, max_per_hour}, pending_human_requests }
```
Drives the right-sidebar status, the connection dot and Settings defaults.

### GET /api/events?date=YYYY-MM-DD&limit=N
Per-tool-call event stream (JSONL-derived, newest last), `limit` clamped 1–5000,
`date` must be `YYYY-MM-DD` (else 400). Verified shape: `{ts, iso, tool, ms, ok,
err, images, client, via}`. Fuels Manage-mode activity feed and usage analytics.

### GET /api/report?date=YYYY-MM-DD
Daily activity report, `text/markdown`. Render in Manage mode (report browser).

### GET /api/approvals
Read-only, **all** pending HITL records: `[{id, kind, prompt, created}]` where
`id` is 8 hex chars, `created` is a float UNIX timestamp, and
`kind ∈ confirm | ask | takeover`. Poll every 5 s while a run is active;
surface in right sidebar + Chrome notification.
**Approve/reject is NOT on this API** — see §Answering HITL below.

## Answering HITL (verified against the live server)
Two channels, by `kind`:

- **`confirm`** (workflow approval checkpoints) — human-only approvals surface,
  gated by `APPROVE_TOKEN`, which no MCP tool ever returns:
  - `GET  {base}/approvals?token=…` → the HTML page
  - `GET  {base}/approvals/list?token=…` → pending `confirm` records only
  - `POST {base}/approvals/{id}/approve|reject?token=…` → `{ok:true, answer}`
    (404 if the record is not `kind:"confirm"`)
  The panel proxies approve/reject **server-side, behind the owner's session**;
  the token never reaches client JS or any model (`.cursor/rules/30-security.mdc`).
- **`ask` / `takeover`** — *cannot* be answered through `/approvals/*`. The agent
  server accepts an answer either from the desktop dialog (zenity writes
  `/home/user/.agentvm/hitl/<id>.ans`) or host-side via
  `manage.sh answer <id> "<text>"` / `manage.sh done <id>`. The panel answers
  these through the Manage host bridge allowlist, not the approvals proxy.

## MCP endpoint (for the agent loop)
`POST https://mcp.hostx.h22t.com/mcp` — MCP Streamable HTTP, same Bearer token.
Use `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport`. ChatGPT-style
clients that can't send headers use `/{token}/mcp` path form — the panel never does.

## Workflow / approval round-trip (critical flow)
1. `POST /api/tools/workflow_run` with steps; a step `{"confirm": "message"}` pauses.
2. Response contains `awaiting_approval` + `approval_id`.
3. Owner approves (panel proxy or approvals page).
4. Resume: `POST /api/tools/workflow_run_saved` (or `workflow_run`) with
   `start_at` + `approval_id`.

## Conventions for the panel's LHOS client (`src/server/lhos/client.ts`)
- zod-validate every response; log `{tool, ms, ok}` to `usage_events` sidecar table.
- Retry idempotent GETs ×2 on 5xx; never retry POST /api/tools/* blindly.
- If LHOS is unreachable or desktop is recreating (error mentions it), surface a
  "computer waking up" state in UI, retry after 30 s — don't fail the run instantly.
