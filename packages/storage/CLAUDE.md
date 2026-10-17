# packages/storage

S3-compatible artifact store (`src/index.ts`): `S3ArtifactStore` (MinIO locally, S3 in AWS),
`MemoryArtifactStore` for tests, `getArtifactStore`/`setArtifactStore`, and `artifactKey`.

## Hard rules

- Object keys are owner-prefixed: `owners/<ownerId>/tasks/<taskId>|misc/<artifactId>/<safeName>`
  (`artifactKey`). Always build keys with it and with a name from `safeArtifactName`
  (`@superagent/policy`).
- The bucket is private. Downloads are streamed through the authenticated API after an ownership
  check; do not add public or presigned URLs.
- `put` computes the sha256, sends it as an S3 checksum and returns it; callers store it in the
  `artifacts` table.
- S3 credentials come from config (`S3_*`); never log them.

## Imports

May import `@superagent/config` and `@aws-sdk/client-s3`. Must not import db or other app packages.

## Tests

`test/index.test.ts` stubs `S3Client.prototype.send` (no network). `MemoryArtifactStore` is also used
by the api and activities tests. Run with:

    pnpm vitest run --project unit packages/storage

Docs: docs/cost-and-retention.md (retention of artifacts), docs/aws-notes.md.
