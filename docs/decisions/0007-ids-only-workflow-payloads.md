# 7. IDs-only Temporal payloads; content stays in Postgres and MinIO

Status: Accepted

## Context

Temporal stores workflow inputs, signals and activity results in its history, which is retained by
the namespace (and outside the app's deletion path). Prompts, emails, tool arguments, screenshots
and files are user content that must follow the app's retention and deletion rules.

## Decision

Workflow and activity payloads carry references and operational metadata only
(`packages/contracts/src/workflow.ts`): task, owner, tool-call, intent and question IDs, counters,
states and short summaries. Signals carry only `{intentId}` or `{questionId}`. Model messages,
tool calls and results live in Postgres (`task_messages`, `tool_calls`), and files in MinIO/S3 under
owner-prefixed keys (`artifactKey` in `packages/storage/src/index.ts`). Activities load content by
ID and owner.

## Consequences

- The daily `retentionWorkflow` and `DELETE /api/me/data` can remove user content without touching
  Temporal history; history retention is set on the namespace (7 days or less on Temporal Cloud).
- A signal is never authority: the workflow always re-reads the persisted approval or answer.
- Every activity does an extra DB read to load what it needs.

Source: `docs/architecture.md` (agent loop), `docs/cost-and-retention.md` (Retention).
