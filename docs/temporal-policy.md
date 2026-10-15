# Temporal policy

## Server

- **Local (default):** `pnpm temporal:dev` runs `temporal server start-dev --ip 127.0.0.1 --port 7233
  --ui-port 8233 --db-filename .local/temporal.db`. State persists across restarts. Deleting
  `.local/temporal.db` is a **reset**, done only by `pnpm infra:reset` after a typed confirmation.
- **Temporal Cloud (opt-in):** `TEMPORAL_MODE=cloud` with an API key or mTLS. The code is identical.

## Workflows

| Workflow | ID | Notes |
|---|---|---|
| `agentTaskWorkflow` | `task-<taskId>` | `REJECT_DUPLICATE`; continue-as-new when suggested; IDs-only payloads |
| `scheduledTaskWorkflow` | `sched-run-<scheduleId>-<fire time>` (Temporal-assigned) | creates the task with idempotency key `sched:<workflowId>`, runs the agent as a child (`REQUEST_CANCEL`) |
| `retentionWorkflow` | `retention-run` via schedule `superagent-retention-daily` (`17 3 * * *` UTC) | deletes expired task content and artifacts |

Lint rules for `packages/workflows/src` forbid Node I/O, `fetch`, `Math.random` and imports from
anything except `@superagent/contracts`. Integration tests replay recorded histories.

## Activity options

| Proxy | Timeout | Retries | Used for |
|---|---|---|---|
| `db` | 30 s | up to 8; non-retryable: `BudgetExceededError`, `SetupRequiredError`, `PartialOutputError`, `ModelConfigError`, `NotFoundError`, `ApprovalError`, `PolicyError` | context, policy evaluation, bookkeeping |
| `llm` | 3 min | 2 | `modelDecision` (deduplicated per step, so a retry never double-charges) |
| `tools` | 6 min, 45 s heartbeat | **1** | sandbox/browser/connector reads; `WAIT_CANCELLATION_COMPLETED` |
| `writes` | 2 min | **1** | `executeApprovedAction`; never retried, and failures are reconciled |

Non-idempotent writes are never blindly retried. Attempt rows record *in flight → confirmed | failed
| unknown* before and after the provider call.

## Approvals and timers

The approval Signal carries only `{intentId}`. The workflow waits with
`condition(signalled, remainingUntilExpiry)`, which is a durable timer that survives worker and
server restarts. After waking it always re-reads the persisted approval through an activity. The
default expiry is 24 hours.

## Schedules

- The IANA timezone is evaluated by Temporal, so it is DST-aware. The integration test checks that
  Sunday 09:00 America/Toronto maps to 13:00 UTC (EDT) and 14:00 UTC (EST).
- Overlap **SKIP**, a catch-up window of 10 minutes by default (1–1440 configurable), and
  `pauseOnFailure: false`.
- Pause/resume/delete go through the outbox and converge to DB state.
- Scheduled runs are **read-only**: external-write tools are not offered and are denied if proposed.

## Restarts (verified by tests)

- **Worker restart mid-approval-wait:** the workflow resumes and executes exactly once.
- **Temporal server restart mid-approval-wait** (same persisted DB file): the workflow is still
  RUNNING and completes after the signal.
- **Lost start** (DB committed, Temporal never started): the reconciler re-enqueues it.
- **Operator-terminated workflow:** the reconciler closes the task projection.
