# Integrations

## 1. Model vendors (orchestrator brains)
Registry `config/models.json` — ships with OpenAI, Anthropic, OpenRouter entries
(ids, context, pricing per 1M tokens, capabilities: tools/vision/streaming).
Settings → Models tab lets the owner: paste vendor keys (encrypted at rest),
enable/disable models, set default + fallback, override pricing.
Adapters (`src/server/models/`):
- **Anthropic**: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` —
  Messages API, tool use, streaming, prompt caching (report cached tokens in usage).
- **OpenAI**: Responses API, tool calling, streaming.
- **OpenRouter**: OpenAI-compatible; model list refreshable from their `/models`.
Usage: every response's token counts × registry pricing → `usage_events` row →
SSE ticker. Show tokens in/out/cached + cost, sortable by vendor/model/day/chat
(Settings → Usage view with export CSV).

## 2. LHOS (the agent computer) — primary integration
See docs/API_REFERENCE.md + docs/MCP_REFERENCE.md. Env: `LHOS_BASE_URL`,
`LHOS_MCP_TOKEN`, `LHOS_VNC_URL`, `E2B_API_URL`, `E2B_API_KEY` (Manage mode).

## 3. VNC embed (watch / takeover)
- Viewer: `https://vnc.hostx.h22t.com/` — access-code sign-in → 30-day HMAC session
  cookie (HttpOnly, SameSite=Lax). 
- **Embed requirement:** panel must be served from a `*.h22t.com` host (same site)
  or the cookie won't flow into the iframe → `panel.hostx.h22t.com` (decided).
- Watch mode: iframe with `pointer-events:none` overlay. Take control: remove
  overlay (viewer's own control mode), hold-to-confirm, log a `takeover` run_step.
- If iframe shows the sign-in page, surface "Sign in to computer view" button that
  opens the viewer in a popup once; cookie then covers the iframe.
- Agent-initiated: MCP `request_takeover` / `ask_user` → poll `hitl_check`/`GET
  /api/approvals` → auto-expand Computer panel + notification + sound.

## 4. Composio (composio.dev)
Purpose: managed third-party app connections (Gmail, Notion, LinkedIn*, Slack…).
- Server SDK `composio` (TS) with `COMPOSIO_API_KEY`; entity id = `owner`.
- Settings → Connectors: list available apps, start OAuth (Composio hosted flow),
  show connection status, disconnect.
- Expose connected-app actions to the agent loop as extra tool defs (namespaced
  `composio.<app>.<action>`), executed server-side via SDK; same approval policy
  for send/post/delete-class actions.
- *Any action against a platform must stay within that platform's ToS.

## 5. Pipedream (pipedream.com)
Purpose: event/webhook glue + their Connect API as an alternative connector source.
- Inbound: Settings → Triggers shows panel webhook URLs (`/api/webhooks/<hook-id>`
  with per-hook signing secret) — paste into Pipedream workflows to trigger saved
  LHOS workflows or panel agent runs on external events.
- Outbound: an agent tool `pipedream.emit` posting to a Pipedream source URL.
- Optional `PIPEDREAM_API_KEY` for listing the owner's workflows in Settings.

## 6. Custom connectors
Settings → Connectors → "Custom": name + base URL + auth header template → stored
encrypted; surfaced to the agent as `http_request` presets via LHOS `connector_save`
(keys go into the LHOS vault through its intake URL — `secret_intake_url` — so raw
keys never transit the model).

## 7. Schedules / Triggers / Webhooks (UI over LHOS)
- Schedules tab = CRUD over LHOS `schedule_*` tools (cron, workflow, enable, run-now)
  + panel-native schedules for agent prompts ("every morning 8:00: inbox brief").
- Trigger URLs via LHOS `trigger_url`; webhooks as §5. All firings appear in the
  right-sidebar timeline + `usage_events`.
