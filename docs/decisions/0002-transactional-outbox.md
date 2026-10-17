# 2. Transactional outbox between the API and Temporal

Status: Accepted

## Context

Creating a task, deciding an approval, answering a question, cancelling, and changing a schedule
each need a database change and a Temporal operation. Doing both directly from a request handler
is a dual write: a crash between them leaves the DB and Temporal out of sync.

## Decision

The API never calls Temporal. Each mutation commits its rows and a `workflow_outbox` row in one
Postgres transaction (`createTaskWithOutbox`, `createScheduleWithOutbox`, `enqueueOutbox` in
`packages/db/src/repos`). The worker drains the outbox every second with `FOR UPDATE SKIP LOCKED`,
exponential backoff and `dead` after 50 attempts (`claimOutbox`/`failOutbox` in
`packages/db/src/repos/tasks.ts`, `drainOutbox` in `apps/worker/src/reconciler.ts`). Every Temporal
operation is idempotent: task workflow ID `task-<taskId>` with `REJECT_DUPLICATE`, schedule ID
`sched-<scheduleId>`, signals carrying only an ID (`packages/temporal/src/index.ts`).

## Consequences

- An outbox row can be processed more than once; handlers must tolerate that.
- State reaches Temporal with up to about a second of delay.
- A projection reconciler (every 60 s) re-enqueues lost starts and closes tasks whose workflow ended
  outside the app.
- Schedule rows converge Temporal to the schedule's current DB state, so out-of-order processing
  is harmless.

Source: `docs/architecture.md` (Request path and dual writes).
