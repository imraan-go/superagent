# SDK notes (pinned versions and gotchas)

| Package | Version | Notes |
|---|---|---|
| `ai` | 7.0.139 | System prompts go in `instructions` (string or `SystemModelMessage[]`). **System messages inside `messages` are rejected.** Tests use `MockLanguageModelV4` from `ai/test`. |
| `@ai-sdk/gateway` | 4.0.112 | `createGateway({apiKey})`. Cost and generation ID come from `providerMetadata.gateway` (`cost`/`gatewayCost`, `generationId`, `routing.modelAttempts[].providerAttempts[].providerRequestId`). Credits via `getCredits()`. |
| `@composio/core` | 0.23.0 | Use `composio.sessions.create(userId, config, requestOptions?)`. Typed `session.execute(slug, args, {account})` takes no signal, so cancellation races an abort promise. `proxyExecute` does not exist. `getRawComposioToolBySlug` returns `version`, `isDeprecated`, `toolkit.slug` and `inputParameters.properties`. |
| `e2b` | 2.56.0 | `Sandbox.create(template, {metadata, timeoutMs, allowInternetAccess, network:{allowPublicTraffic, denyOut}})`, `Sandbox.list({query:{metadata, state}})` pager, `Sandbox.kill`. The Template SDK has `Template().fromBaseImage().aptInstall().runCmd(cmd, {user:'root'}).pipInstall().setUser().setStartCmd(cmd, waitForURL(url))` and `Template.build(tpl, name, opts)`. |
| `@temporalio/*` | 1.24.0 | Tests use `TestWorkflowEnvironment.createLocal({server:{executable:{type:'existing-path', path}, ip, port, dbFilename, ui:false}})`. A thrown error's `name` becomes the ApplicationFailure type used by `nonRetryableErrorTypes`. Schedules: `ScheduleAlreadyRunning`, `ScheduleNotFoundError`, `handle.trigger()`. |
| `better-auth` | 1.7.7 | `drizzleAdapter(db, {provider:'pg', schema})`. Auth endpoints are rate limited (sign-up ≈ 3 per 10 s), so e2e tests sign up once and reuse the session. |
| `next` / `react` | 16.4.0 / 19.3.0 | `rewrites()` are resolved at **build** time, so set `API_INTERNAL_URL` when building the web image. |
| `drizzle-orm` / `pg` | 0.45.4 / 8.23.1 | Migrations with `drizzle-kit generate --name <x>` in `packages/db`. Tests use PGlite with the same migrations. |
| `hono` / `@hono/node-server` | 4.13.13 / 2.1.5 | – |
| `zod` | 4.6.7 | `schema.toJSONSchema()` produces the tool schemas sent to the model. |
| `@playwright/test` | 1.64.0 | e2e uses `channel: 'chrome'` (installed Google Chrome), not a bundled browser. |

## Tooling

- pnpm 12 via Corepack, with `minimumReleaseAgeStrict: true` (fresh releases are not installed) and
  an explicit `allowBuilds` list for native packages.
- Python packages in E2B templates are pinned to releases at least 7 days old.
- Docker images are pinned by digest: `postgres:17-alpine`, and `cgr.dev/chainguard/minio` because
  `minio/minio` is no longer published on Docker Hub.
