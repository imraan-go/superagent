# packages/policy

Pure policy code: tool registry and classification (`src/tools.ts`), canonical approval hashing
(`src/canonical.ts`), browser SSRF checks (`src/net.ts`), workspace path checks (`src/paths.ts`) and
the curated connector catalogue (`src/connector-catalog.ts` + `connector-catalog.lock.json`).

## Hard rules

- Classification is app-owned. Never trust provider or MCP annotations. Anything that changes data
  outside the app is `external_write` and needs exact approval; read-only runs deny it.
- `canonicalJson` and `intentHash` must stay byte-for-byte stable: sorted keys, `undefined` dropped,
  NFC strings, non-finite numbers rejected, `{v: 1, ...binding}`. A change invalidates every pending
  approval. If the binding must change, bump `v` and keep old intents verifiable.
- Tool schemas are `.strict()` Zod objects, so the model cannot smuggle extra fields.
- Connector candidates are offered only when `connector-catalog.lock.json` has the slug, the same
  toolkit and every curated parameter. The lock is written by `pnpm composio:discover`; do not
  hand-edit it except to remove entries.
- Every connector `external_write` lists `destinationFields` that exist in its schema (enforced in
  `test/policy.test.ts`).
- No I/O here (except `node:crypto`). This package is imported by db, agent, connectors, execution,
  activities and api.

## Imports

May import `@superagent/contracts` and `zod` only.

## Tests

    pnpm vitest run --project unit packages/policy

Docs: docs/architecture.md (Approvals, Tool surface), docs/composio-matrix.md, docs/e2b-chrome.md.
