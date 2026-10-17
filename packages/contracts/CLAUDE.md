# packages/contracts

Shared types: Zod request schemas (`src/index.ts`), settings schemas (`src/settings.ts`) and the
workflow <-> activity contract (`src/workflow.ts`).

## Hard rules

- This is a leaf package: it depends only on `zod`. Never import another `@superagent/*` package.
- `src/workflow.ts` is bundled into Temporal workflow code. Keep it free of runtime dependencies
  (no zod, no Node modules): types and plain constants only.
- Workflow payload types carry references and operational metadata only (IDs, counters, states).
  No tokens, email bodies, prompts, tool arguments, screenshots or file contents.
- `AgentActivities` is the single source of truth for the activity surface. Changing it requires
  matching changes in `packages/activities/src/index.ts` (`createActivities`) and the fake in
  `packages/workflows/test/workflows.int.test.ts`.
- `ConnectorToolkit` is the one enum of supported Composio toolkits, shared by the Connect API,
  `packages/connectors` and `packages/policy`.
- Renaming exported constants (`APPROVAL_SIGNAL`, `taskWorkflowId`, workflow type names) breaks
  running workflows and schedules.

## Exports

`@superagent/contracts`, `@superagent/contracts/workflow`, `@superagent/contracts/settings`
(see `package.json`).

## Tests

`test/index.test.ts`, `test/settings.test.ts` and `test/workflow.test.ts` cover the schemas, settings
merging and workflow ids; the api, policy and activities tests exercise them too. Run with:

    pnpm vitest run --project unit packages/contracts

Typecheck everything that depends on it: `pnpm typecheck`.
