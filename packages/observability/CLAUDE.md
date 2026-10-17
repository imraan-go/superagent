# packages/observability

Structured, redacting JSON logger (`createLogger`, `redact`, `redactString` in `src/index.ts`) and
integer money helpers (`src/money.ts`: `usdToNanos`, `nanosToUsd`, `priceTimes`).

## Hard rules

- Every log line and every persisted event payload passes through `redact()`. Keys matching the
  sensitive pattern (api key, token, secret, password, cookie, session/MCP URL, CDP, credential, ...)
  and known key formats (Bearer, `sk-`, `ghp_`, `xox*-`, PEM keys, CDP URLs) are replaced.
- When you add a new kind of secret to the system, add its key name or value pattern here and a test.
- Fields named `*tokens` with numeric values are usage counters and stay readable.
- Money is `bigint` nanos (1e-9 USD). Never use floating point for cost or budget math.
- Logs go to stdout/stderr only; the app does not store logs.

## Imports

May import `@superagent/contracts` only. Everything else depends on this package, so keep it small.

## Tests

    pnpm vitest run --project unit packages/observability

Docs: docs/cost-and-retention.md.
