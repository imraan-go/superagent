# Architecture decision records

Short records of decisions that the code and docs already reflect. Each has a Status, Context,
Decision and Consequences, and cites the files that implement it. Add a new record as
`NNNN-kebab-title.md` with the next number; supersede a record instead of rewriting it.

- [0001 Temporal for durable agent runs](0001-temporal-for-durable-runs.md)
- [0002 Transactional outbox between the API and Temporal](0002-transactional-outbox.md)
- [0003 E2B sandboxes for code and browsing](0003-e2b-sandboxes-for-execution.md)
- [0004 Composio for user connections, with an explicit account per execution](0004-composio-explicit-account-per-execution.md)
- [0005 Exact-approval hashing before anything leaves the user's account](0005-exact-approval-hashing.md)
- [0006 Vercel AI Gateway with a model allowlist](0006-vercel-ai-gateway-with-model-allowlist.md)
- [0007 IDs-only Temporal payloads; content stays in Postgres and MinIO](0007-ids-only-workflow-payloads.md)
