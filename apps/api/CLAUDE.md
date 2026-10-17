# apps/api

Hono HTTP API on 127.0.0.1:3001 (`src/index.ts`, routes in `src/app.ts` and `src/routes/*.ts`):
Better Auth sessions, owner-scoped resources, approvals, connections, uploads, run event streams.

## Hard rules

- Every `/api/*` route except `/api/health` and `/api/auth/*` runs behind the session middleware.
  Get the caller with `uid(c)` and pass it as `ownerId` to an owner-scoped `@superagent/db`
  repository. Never query by ID alone. A missing or foreign resource is a 404 (`NotFoundError`).
- Non-GET requests must carry an allowed `Origin` (`allowedOrigins`); do not add exceptions.
- Validate request bodies with Zod schemas from `@superagent/contracts` via `body(c, Schema)`.
- The API never calls Temporal. A mutation that needs a workflow writes its rows and a
  `workflow_outbox` row in one transaction (`createTaskWithOutbox`, `createScheduleWithOutbox`,
  `enqueueOutbox`); the worker drains it. `@superagent/temporal` is in package.json but unused here.
- Approval decisions require the exact `argsHash` and `nonce` (`ApprovalDecisionRequest`,
  `decideIntent`). Never accept a decision without them.
- The Composio user ID is derived server-side (`composioUserIdFor`); callback query parameters are
  never trusted, connections are verified against Composio.
- Artifacts are streamed through the API after an ownership check; never return storage URLs.
- Log with the injected redacting logger; never log cookies, keys or request bodies with secrets.
- External services come in through `ApiDeps` (`connections`, `store`) so tests can fake them.

## Imports

May import config, contracts, db, connectors, storage, policy, observability. Must not import
activities, workflows, execution or apps/*.

## Tests

`test/api.test.ts`, `test/chats.test.ts`: PGlite with real migrations and real Better Auth, fake
Composio and `MemoryArtifactStore`, requests via `app.request(...)`.

    pnpm vitest run --project unit apps/api

Docs: docs/architecture.md (Request path, Identity and ownership), docs/web-app.md (API map).
Dev seed user: `pnpm db:seed:dev` (`src/seed-dev.ts`, refuses in production).
