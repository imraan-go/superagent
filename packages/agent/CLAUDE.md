# packages/agent

Model access through the Vercel AI Gateway (`src/provider.ts`), live catalogue checks
(`src/catalog.ts`) and prompt/context assembly (`src/context.ts`).

## Hard rules

- Model calls go through the Gateway only (`createGateway` from `@ai-sdk/gateway`). ESLint forbids
  `@ai-sdk/openai`, `@ai-sdk/anthropic`, `openai` and `@anthropic-ai/sdk` repo-wide.
- A model is usable only if it is on the allowlist (`modelAllowlist()` in `@superagent/config`), is
  in the live catalogue and has the required capabilities (`checkModel`).
- One decision is one step: tools are passed without `execute`, so the AI SDK never runs a tool. The
  activity layer evaluates and executes proposals.
- System prompts go in `instructions`, not as system messages inside `messages` (AI SDK 7 rejects
  them; docs/sdk-notes.md).
- Cost and IDs come from `providerMetadata.gateway` (`extractUsage`). Money is integer nanos
  (`usdToNanos`/`priceTimes` from observability); never use floats for cost.
- `SYSTEM_PROMPT` tells the model that fetched content is untrusted data. Keep that instruction when
  editing the prompt.
- No DB, Temporal or Composio access here.

## Imports

May import config, contracts, observability, policy, `ai`, `@ai-sdk/gateway`, `zod`. Must not import
db, activities, connectors, execution or apps/*.

## Tests

`test/agent.test.ts` uses `MockLanguageModelV4` from `ai/test`; no network.

    pnpm vitest run --project unit packages/agent

Docs: docs/sdk-notes.md, docs/cost-and-retention.md. Check configured models live with
`pnpm models:verify`.
