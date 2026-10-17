# 3. E2B sandboxes for code and browsing

Status: Accepted

## Context

The agent runs Python, writes files and browses the web. None of that may run on the app's own
hosts, see app secrets, or reach private networks.

## Decision

Code and browsing run in E2B cloud sandboxes (`packages/execution`). There are two templates
(`infra/e2b`): `superagent-code` (Python 3.12, internet off unless `E2B_CODE_INTERNET_ACCESS=true`)
and `superagent-browser` (Google Chrome stable, headless, CDP on sandbox loopback only, enterprise
policies). The model never gets CDP, VNC or a shell: each browser tool call is one validated action
run by `browser_ctl.py` through the E2B command API, with domain allowlist and DNS checks before
and a final-URL recheck after (`packages/execution/src/browser.ts`). Workspaces are DB rows with
leases; sandboxes pause when idle and before approval waits, browsers are killed at task end, and
the worker sweeps orphaned app-tagged sandboxes every 15 minutes.

## Consequences

- No API key or env var is injected into a sandbox; commands get only the per-call payload.
- Live code and browser runs need `E2B_API_KEY` and `pnpm e2b:template:build`; without it these
  tools are not offered.
- Sandbox cost is *estimated* only when `E2B_RATE_USD_PER_SECOND` is set, otherwise *unknown*.
- Approved domains can still serve hostile content; the browser is isolated but is a full Chrome
  (residual risk in `docs/architecture.md`).

Source: `docs/e2b-chrome.md`.
