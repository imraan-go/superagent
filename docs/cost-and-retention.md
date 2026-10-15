# Cost, limits and retention

## Budgets

| Setting | Local value | Meaning |
|---|---|---|
| `MAX_COST_PER_RUN` | 0.25 USD | Per task run (all model decisions + estimated sandbox time) |
| `MONTHLY_COST_LIMIT` | 10 USD | Per user per calendar month (UTC) |
| `LIVE_SMOKE_MAX_COST` | 1 USD | Cumulative cap for `pnpm smoke:cloud` (tasks titled `[smoke] …`) |

Users can only **tighten** their own limits (`PUT /api/settings/budget`). Live execution refuses to
run when the per-run or monthly limit is unset.

### Reservation flow (atomic)

1. Before each model call, the worst-case cost is computed from the live catalogue price × (input
   estimate + `AI_MAX_OUTPUT_TOKENS`), plus any Gateway surcharge.
2. That amount is **reserved** in one transaction against both the run and monthly limits. Key:
   `model:{taskId}:{step}:{attempt}`.
3. After the call the reservation is **settled** at the measured Gateway cost.
4. If no cost is reported, it is settled at the estimate and labelled *estimated*. If the call
   errors, it is settled conservatively at the estimate.
5. If a reservation would exceed a limit, the call is not made, a `budget.blocked` event is shown,
   and the task fails cleanly.

### Cost labels

| Label | When |
|---|---|
| **measured** | The Gateway reported the generation cost (`providerMetadata.gateway.cost`) |
| **estimated** | Computed from catalogue prices or the operator-entered E2B rate (`E2B_RATE_USD_PER_SECOND`, with `E2B_RATE_SOURCE`) |
| **unknown** | No reliable figure; E2B time without a configured rate is recorded as active seconds only |

Usage rows also record input, output, cache-read and cache-write tokens, the generation ID, provider
request ID and resolved provider. Prompt caching is on: the static system prompt is marked
`cacheControl: ephemeral` for Anthropic models through the Gateway, and the per-task context is a
separate, uncached system message. The live M1 run showed a 1,084-token cache write followed by an
846-token cache read.

## Run limits

| Limit | Default |
|---|---|
| Model decisions per run | 20 |
| Tool calls per run | 30 |
| Active execution per run | 15 minutes |
| E2B idle pause | 5 minutes |
| Approval expiry | 24 hours |
| Max artifact size | 25 MB (browser downloads 10 MB) |

## Retention

| Data | Retention | Mechanism |
|---|---|---|
| Tasks, messages, events, tool calls, intents | 30 days after creation (`TASK_RETENTION_DAYS`), once terminal | Daily `retentionWorkflow`; cascades |
| Artifacts (MinIO/S3 objects + rows) | Same 30 days | Object deleted first, then marked deleted; the task row is removed only after all its artifacts are gone |
| Processed outbox rows | 7 days (`OPERATIONAL_LOG_RETENTION_DAYS`) | Daily `retentionWorkflow` |
| Operational logs (stdout JSON, redacted) | 7 days | Configure in the log sink (e.g. CloudWatch log-group retention); the app does not store logs |
| Temporal history | Namespace retention | Set to ≤ 7 days on Temporal Cloud; payloads carry IDs only |
| E2B sandboxes | Killed at task end (browser), paused when idle (code), orphans swept every 15 min | Worker |

Users can export their data (`GET /api/export`, redacted of credentials) and delete all of it
(`DELETE /api/me/data`, refused while tasks are running). Deletion removes the user's rows and
artifact objects, revokes their Composio connections (best effort; failures are reported), and
deletes their schedules in Temporal. Their E2B sandboxes are left unclaimed, and the worker's orphan
sweep destroys them within about 15 minutes.

The response lists residual copies outside the app's immediate control: Temporal histories until
namespace retention ends, and provider-side logs under those providers' policies.
