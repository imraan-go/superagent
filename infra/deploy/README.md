# Deploy runbook

This runbook covers building and checking images locally. The AWS shape is described in
[docs/aws-notes.md](../../docs/aws-notes.md). **Do not deploy publicly without the owner's explicit
approval.**

## Build

From the repo root (`.dockerignore` keeps `.env`, `.local`, keys and `node_modules` out of the
context):

```bash
docker build -f infra/deploy/Dockerfile --target api    -t superagent-api .
docker build -f infra/deploy/Dockerfile --target worker -t superagent-worker .
docker build -f infra/deploy/Dockerfile --target web    --build-arg API_INTERNAL_URL=http://api.internal:3001 -t superagent-web .
```

Verified locally:
- All three targets build.
- Containers run as UID 10001 with root-owned app files.
- The API exits with a key-names-only setup error when unconfigured.
- The web container serves `/login`.

## Release steps

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` must pass.
2. Build and push the images, tagged with the git SHA, to a private registry (e.g. ECR).
3. Run migrations as a one-off task using the api image:
   `/app/node_modules/.bin/tsx /app/packages/db/src/migrate.ts`.
4. Roll out the worker first. Workflow code changes must be replay-compatible: run the replay test
   against recent histories, or use Temporal worker versioning.
5. Roll out the api, then the web service.
6. Run `pnpm setup:doctor` against the environment from an operator shell that has read-only access
   to the same secrets.

## Rollback

- Images: redeploy the previous SHA.
- Database: migrations are additive. Never drop columns in the same release that stops using them.
- Workflows: keep the old worker build available until in-flight executions on the old code have
  finished (approval waits can last up to `APPROVAL_EXPIRY_HOURS`).

## Operations

| Task | How |
|---|---|
| Stuck outbox rows | `select kind, attempts, last_error from workflow_outbox where status <> 'done'`; rows are `dead` after 50 attempts |
| Orphaned sandboxes | Run `pnpm cleanup:cloud` (dry run), then `--yes` |
| Pause all schedules | Pause in the app per user, or use the Temporal CLI / Cloud UI. Never delete `.local/temporal.db` or a namespace as a "stop". |
| Rotate a secret | Update it in Secrets Manager, then force a new deployment of the services that use it |
