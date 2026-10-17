# 4. Composio for user connections, with an explicit account per execution

Status: Accepted

## Context

The agent reads and (with approval) writes in the user's own accounts: Gmail, Google Calendar,
Drive, Docs, Sheets, GitHub, Notion, Slack, Outlook. The app should not store OAuth tokens itself,
and a call must never run against the wrong account or an unvetted tool.

## Decision

Connections go through Composio (`@composio/core` 0.23, `packages/connectors/src/index.ts`).
Every execution creates a session for the server-derived Composio user ID with
`sessionPreset: 'direct_tools'`, exactly one enabled slug, `connectedAccounts: {toolkit: account}`,
`manageConnections: false` and the sandbox off. The adapter refuses slugs outside
`CONNECTOR_CANDIDATES` and sessions that report a different bound account. The model sees only
curated, strict tool schemas (`packages/policy/src/connector-catalog.ts`), offered only after
`pnpm composio:discover` locks them in `connector-catalog.lock.json`. Connect callbacks are verified
by listing the user's accounts at Composio; query parameters are never trusted.

## Consequences

- No `account` argument is sent to `execute`: this project has multi-account selection off and
  Composio rejects it (`ToolRouterV2_BadRequest` 4300; `docs/sdk-notes.md`).
- Adding a tool requires a live Composio key to verify it.
- Composio is a third-party processor of user data. Production Google scopes need the owner's own
  verified OAuth app, and Gmail restricted scopes need CASA, which this project does not claim.

Source: `docs/composio-matrix.md`, `docs/architecture.md`.
