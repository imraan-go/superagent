# Composio capability matrix

Connectors use **Composio sessions** (`@composio/core` 0.23, `sessionPreset: 'direct_tools'`,
`manageConnections: false`, sandbox off). The model only ever sees the app's curated tool schemas.
Composio meta-tools, MCP URLs and auto-execution are never handed to it.

Every execution creates a session for the server-derived Composio user ID, enables exactly one tool
slug, and pins `connectedAccounts: {toolkit: <the user's verified account>}`. The execute call does
not send an `account` argument: this project has multi-account selection disabled, and Composio
rejects that field with `ToolRouterV2_BadRequest` (4300).

A curated tool is offered only after `pnpm composio:discover` has locked it in
`packages/policy/src/connector-catalog.lock.json`. Locking requires all of:
- the slug exists in your project's catalogue;
- the tool is not deprecated;
- a toolkit version is reported, which is pinned at execution;
- every curated parameter exists upstream.

| Toolkit | Tool (slug) | Class | Curated parameters | Gate |
|---|---|---|---|---|
| GitHub | `GITHUB_GET_THE_AUTHENTICATED_USER` | read | – | connected account |
| GitHub | `GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER` | read | `per_page` ≤ 50, `sort` | connected account |
| Google Calendar | `GOOGLECALENDAR_EVENTS_LIST` | read | `calendarId` = `primary`, `timeMin`, `timeMax`, `maxResults` ≤ 50, `singleEvents`, `orderBy` | connected account |
| Google Drive | `GOOGLEDRIVE_FIND_FILE` | read (metadata) | `q`, `pageSize` ≤ 25 | connected account |
| Gmail | `GMAIL_FETCH_EMAILS` | read | `query`, `max_results` ≤ 10 | connected account |
| Gmail | `GMAIL_CREATE_EMAIL_DRAFT` | external write | `recipient_email`, `subject`, `body` | exact approval; not in read-only runs |
| Gmail | `GMAIL_SEND_EMAIL` | external write | `recipient_email`, `subject`, `body` | exact approval; not in read-only runs |

Notion is accepted by the connection flow but has no curated tools yet.

## Order of enablement

1. **GitHub, Calendar, Drive reads.** These are the M4 target; Composio-managed auth is fine in
   development.
2. **Gmail read**, then the **draft** write behind approval.
3. **Gmail send**, last. Before any real send, the assistant obtains the user's explicit go-ahead for
   that exact message, in addition to the in-app approval.

## Gmail notes

- Composio-managed Google auth is for development. Production needs your own Google Cloud OAuth app
  with a verified consent screen. Restricted Gmail scopes require Google's security assessment
  (CASA). This project has **not** been assessed and makes no compliance claim.
- Outbound content is approval-bound to the exact recipient, subject and body. Attachments are not
  curated yet.

## Connection lifecycle

1. **Connect:** `POST /api/connections` creates a Connect Link (`session.authorize(toolkit,
   {callbackUrl})`). The user completes OAuth in their own browser.
2. **Callback:** `/api/connections/callback?cid=…` maps the stored row ID to its Composio connected
   account ID. The callback is **verified** server-side by listing the user's accounts at Composio;
   query parameters are never trusted.
3. **Status:** a provider auth error during a read marks the connection `expired` and shows a
   reconnect prompt. Revoked or disconnected accounts invalidate pending approvals bound to them.
4. **Disconnect:** deletes the connected account at Composio.
