# packages/connectors

Composio adapter (`src/index.ts`, `ComposioConnector`): Connect Links, connection verification,
disconnect, and execution of one curated tool against one explicitly bound account.

## Hard rules

- Every execution creates a session for the server-derived Composio user ID with
  `sessionPreset: 'direct_tools'`, exactly one enabled slug, `connectedAccounts: {[toolkit]: id}`,
  `manageConnections: false` and the sandbox off. Never pass an `account` argument to `execute`
  (Composio rejects it on this project: `ToolRouterV2_BadRequest` 4300; docs/sdk-notes.md).
- `execute` refuses slugs that are not in `CONNECTOR_CANDIDATES`, and refuses to run when the session
  reports a different bound account. Keep both checks.
- Composio meta-tools, session MCP URLs and auto-execution are never exposed to the model.
- `COMPOSIO_API_KEY`, session URLs and headers stay in this process. Never log them or pass them to a
  sandbox or the model.
- Callback query parameters are never trusted: connections are verified by listing the user's
  accounts at Composio (`verify`).
- `Toolkit` is `ConnectorToolkit` from `@superagent/contracts`; add toolkits there, not here.

## Imports

May import config, contracts, policy, `@composio/core`. Must not import db, activities or apps/*.

## Tests

`test/index.test.ts` mocks `@composio/core`; no network.

    pnpm vitest run --project unit packages/connectors

Connector behaviour inside a run is tested in `packages/activities/test/activities.test.ts`.
Docs: docs/composio-matrix.md, docs/sdk-notes.md. Adding a tool: `.claude/skills/add-connector-tool`.
