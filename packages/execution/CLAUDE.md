# packages/execution

E2B sandboxes: workspace lifecycle with leases, pause/resume and orphan sweep
(`src/workspaces.ts`), code workspace file and Python helpers (`src/code.ts`), and the mediated
Google Chrome controller (`src/browser.ts`, `src/browser_ctl.py`, run inside the sandbox).

## Hard rules

- No API key, Composio credential or app env var is ever injected into a sandbox. Commands get only
  the per-call payload (`BCTL_REQ`).
- The model never gets CDP, VNC or a shell. Each browser tool call is one validated action.
- Browser destinations: check the URL against the task's approved domains, resolve DNS and reject
  private/loopback/link-local/metadata ranges (`validateDestination`, `assertPublicResolution`),
  then re-validate the final URL after the action and blank the page on violation.
- Workspace paths are relative to `/home/user/workspace`; traversal, absolute paths, control
  characters and backslashes are rejected (`checkWorkspacePath` in `@superagent/policy`).
- One sandbox is driven by one holder at a time: acquire the lease through `WorkspaceStore` before
  using it (`WorkspaceBusyError` otherwise).
- Sandboxes carry `APP_METADATA` tags. The orphan sweep kills only app-tagged sandboxes no row claims.
- Persistence goes through the `WorkspaceStore` interface; this package does not import db.

## Imports

May import config, contracts, policy, `e2b`. Must not import db, activities or apps/*.

## Tests

`test/execution.test.ts` uses a fake `SandboxApi`/`WorkspaceStore` and a fake DNS resolver.

    pnpm vitest run --project unit packages/execution

Docs: docs/e2b-chrome.md. Templates live in `infra/e2b` (`pnpm e2b:template:build`).
