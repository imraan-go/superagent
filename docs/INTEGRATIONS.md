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

## 4. Composio (composio.dev) — the connector + MCP layer

Verified 2026-10-15 against the live OpenAPI document
(`https://backend.composio.dev/api/v3.1/openapi.json`) and docs.composio.dev.
No SDK: a small REST client (`src/server/connectors/composio-client.ts`, fetch
injected, mock-tested). Everything is server-side; the key is the sealed
`secrets` row `composio` (Settings → Connectors) and never reaches the browser,
the model, logs or tests.

**Base / auth / paging.** `https://backend.composio.dev/api/v3.1` (v3 still
works). Header `x-api-key: <project key>`. Lists are cursor-paginated:
`?limit=&cursor=` → `{items, next_cursor, total_items}`; MCP lists use
`page_no`. Single Composio user id: `owner`.

| Need | Call |
|---|---|
| Full catalog | `GET /toolkits?sort_by=usage&managed_by=all&limit=200&cursor=` (auto-paginated, cached 1 h). Item: `slug,name,auth_schemes,composio_managed_auth_schemes,no_auth,meta{description,logo,categories,tools_count,triggers_count}` |
| Categories | `GET /toolkits/categories` |
| Toolkit auth detail | `GET /toolkits/{slug}` → `auth_config_details[].mode`, `.fields.connected_account_initiation.{required,optional}` |
| Auth config | `GET /auth_configs?toolkit_slug=` then `POST /auth_configs` `{toolkit:{slug}, auth_config:{type:"use_composio_managed_auth"}}` (or `{type:"use_custom_auth", authScheme}` for API_KEY/BEARER/BASIC) |
| OAuth connect | `POST /connected_accounts/link` `{auth_config_id, user_id:"owner", callback_url}` → `{redirect_url, connected_account_id}`; opened in a new tab, then the panel polls `GET /connected_accounts?user_ids=owner` until `status:"ACTIVE"` (statuses: INITIALIZING, INITIATED, ACTIVE, FAILED, EXPIRED, INACTIVE, REVOKED) |
| Credential connect | `POST /connected_accounts` `{auth_config:{id}, connection:{user_id, state:{authScheme:"API_KEY", val:{status:"ACTIVE", ...fields}}}}` — values pass straight through; not stored/echoed |
| Disconnect | `DELETE /connected_accounts/{id}?revoke_on_delete=true` |
| Tools | `GET /tools?toolkit_slug=&toolkit_versions=latest&limit=100&cursor=` (cached 1 h); item `slug,description,input_parameters,is_deprecated` |
| Execute | `POST /tools/execute/{TOOL_SLUG}` `{user_id:"owner", arguments, version:"latest"}` → `{data, error, successful, log_id}` |
| MCP | `POST /mcp/servers` `{name, auth_config_ids, allowed_tools, managed_auth_via_composio:false}` → `{id, mcp_url}`; `PATCH /mcp/{id}`; `POST /mcp/servers/generate` `{mcp_server_id, user_ids:["owner"]}` → per-user URL; `DELETE /mcp/{id}`. Clients authenticate with `x-api-key`. |
| Trigger types | `GET /triggers_types?toolkit_slugs=gmail&toolkit_slugs=…` |
| Trigger instance | `POST /trigger_instances/{SLUG}/upsert` `{connected_account_id, user_id, trigger_config}` → `{trigger_id}`; `GET /trigger_instances/active?user_ids=owner`; `DELETE /trigger_instances/manage/{id}` |
| Delivery | `POST /webhook_subscriptions` `{webhook_url, enabled_events:["composio.trigger.message"], version:"V3"}` → `{id, secret}` (project-level). Deliveries carry `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<b64>` = base64(HMAC-SHA256(secret, `${id}.${ts}.${body}`)); envelope `{id,type,metadata{trigger_id,trigger_slug,connected_account_id,user_id},data,timestamp}` |

**Panel behaviour**
- *Catalog* (Settings → Connectors → Composio): search, category filter, logo (via the same-origin
  `/api/connectors/composio/logo` proxy because CSP is `img-src 'self'`), auth scheme, tool/trigger
  counts, "own app" badge when Composio hosts no OAuth app. The owner's priority set (Gmail, Drive,
  Calendar, Docs, Sheets, Notion, LinkedIn, WhatsApp, Slack, GitHub, Facebook, Instagram, Meta Ads,
  X/Twitter, Outlook, HubSpot) is pinned first.
- *Agent tools*: per connected toolkit the owner picks tools; the default is **read-only tools only**
  (first token get/list/fetch/search/find/read/query/…, no write verb anywhere in the slug). Exposed as
  `composio__<toolkit>__<action>` with trimmed schemas; a 14 000-token schema budget applies across all
  Composio tools (read-only tools kept first); Settings shows a per-tool and total token estimate.
  Execution: `POST /tools/execute` as user `owner`, rate-limited (60/min), result returned as untrusted data.
- *Approval gate* (`agent/policy.ts`): any `composio__*` / `mcp__composio__*` tool whose action is not
  recognisably read-only requires owner approval (fail closed), on top of the send/post/delete/share
  patterns and the hard deny-list. Settings can only make this stricter.
- *MCP*: "Create server" builds a Composio MCP server from the connected toolkits' enabled tools,
  registers it as remote MCP server `composio` (**disabled by default**; direct execution stays the
  default path and enabling both would list tools twice) and shows the URL (masked if it carries a
  key/token query).
- *Triggers*: enabling one creates the Composio trigger instance plus a panel webhook (prompt target);
  Composio delivers to the public `POST /api/webhooks/composio`, which verifies the Standard-Webhooks
  signature (5-minute window, replay memory, rate limit) with the sealed subscription secret and fires
  the mapped panel webhook through `fireWebhook` (payload wrapped as untrusted data; unattended-run
  budget guard unchanged).
- Config lives in one `connectors` row (`kind=composio`, `name=composio-config`): enabled tools, MCP
  server ids, trigger→webhook map, sealed subscription secret. No credential is stored there.
- *Platform ToS*: actions run through each provider's official API via Composio; nothing here
  evades platform automation controls.

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
