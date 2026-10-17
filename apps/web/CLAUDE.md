@AGENTS.md

# apps/web

Next.js 16 / React 19 dashboard (chat workspace, Mission rail, Connect Apps, Settings, Workspaces
view) on http://localhost:3000. See docs/web-app.md for the feature and API map.

## Hard rules

- The browser talks only to this origin. `/api/*` is rewritten to the API (`next.config.ts`,
  `API_INTERNAL_URL`, default `http://127.0.0.1:3001`). Never call the API's host directly from
  client code and never call Composio, E2B, Temporal or the Gateway from the web app.
- Server components fetch the API through `src/server/api.ts` (`server-only`), forwarding the
  caller's cookies so the API still enforces ownership.
- `src/proxy.ts` only redirects to `/login` when no session cookie exists; it is not an auth check.
  Authorization lives in the API.
- Mutations use same-origin JSON requests (the typed client in `src/lib/api.ts`) so the API's Origin
  check passes; there is no CSRF token.
- The only workspace package the app may import is `@superagent/contracts` (listed in
  `transpilePackages`). Do not import db, policy or any server package.
- Security headers and CSP are set in `next.config.ts`; keep `connect-src 'self'`.
- Never render secrets; e2e checks the settings page shows none.
- `rewrites()` are resolved at build time; set `API_INTERNAL_URL` when building the image.
- Import app modules through the `@/` alias (maps to `src/`; the `web` vitest project resolves it too).

## Tests

Pure modules have `*.test.ts` next to them under `src/` (project `web`, node environment, no DOM):

    pnpm vitest run --project web
    pnpm vitest run --project web apps/web/src/lib/hotkeys.test.ts

End-to-end (Playwright, installed Google Chrome, against the running stack from `pnpm dev` +
`pnpm worker:dev`): `pnpm test:e2e` (`e2e/app.spec.ts`).

Typecheck: `pnpm --filter @superagent/web typecheck`. Lint rules for React hooks and Next.js apply
to `apps/web/**` (`eslint.config.mjs`).
