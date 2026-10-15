# E2B workspaces and Google Chrome

## Templates (`infra/e2b`)

`pnpm e2b:template:build` builds two templates with the E2B 2.56 Template SDK:

**`superagent-browser`**
- Starts from the E2B base image.
- Installs **Google Chrome stable** from Google's signed apt repository (`dl.google.com`, key
  verified by apt). There is no Chromium and no Playwright-bundled browser.
- Installs fonts and Playwright for Python 1.63.0, which is used only to *connect* over CDP.
- Writes Chrome enterprise policies to `/etc/opt/chrome/policies/managed/superagent.json`.
- The start command runs Chrome headless as the unprivileged `user` with
  `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222` and an ephemeral profile. The
  sandbox is ready when `http://127.0.0.1:9222/json/version` answers.

**`superagent-code`**
- Starts from E2B's Python 3.12 image (the default base image is 3.11, which cannot install numpy 2.5), with pinned numpy, pandas and matplotlib.

Python pins are at least 7 days old, matching the npm release-age policy.

The build has not run yet because `E2B_API_KEY` is not configured.

## Chrome policies

These policies are defence in depth behind the worker-side checks:
- Sign-in, sync, the password manager, autofill and payment queries are off.
- All extension installs are blocked.
- Notifications, geolocation, sensors, serial, Bluetooth and USB are denied.
- Downloads go to `/tmp/superagent/downloads` without prompting.
- The URL blocklist covers `file://`, `chrome://`, `devtools://`, `view-source:`, `javascript:`,
  localhost/loopback, `0.0.0.0` and the cloud metadata hosts.

## Mediated browser surface

The model never gets CDP, VNC or a shell. Each browser tool call is one validated action:

1. The worker checks the URL against the task's approved domains (exact, `www.` or `*.` wildcard)
   and resolves DNS, rejecting private, loopback, link-local and metadata ranges.
2. The worker runs `browser_ctl.py` inside the sandbox through the authenticated E2B command API. It
   connects to `127.0.0.1:9222`, routes every request through a host guard, and performs exactly one
   action.
3. Afterwards the final URL is re-validated. A redirect or script navigation to a disallowed place
   blanks the page and surfaces a policy error.
4. Page text is returned inside `UNTRUSTED` markers. Screenshots become artifacts, and only the most
   recent one is sent to the vision model.
5. Downloads are capped at 10 MB, content-type checked, stored with sha256, and served as
   attachments.

## Workspace lifecycle

- One code workspace per owner (and per task scope for the browser). A DB row holds the sandbox ID,
  state and a lease, so two activities never drive one sandbox at once.
- Sandboxes are created with metadata `{app, workspaceId, kind}` and an idle timeout of
  `E2B_IDLE_PAUSE_MINUTES` (5).
- Both kinds set `allowPublicTraffic: false`, so sandbox ports (including 9222) are not reachable
  through E2B's public proxy without the sandbox traffic token.
- Code sandboxes have internet **off** unless `E2B_CODE_INTERNET_ACCESS=true`. Browser sandboxes
  have internet on, with E2B egress `denyOut` for private IPv4 ranges.
- They are paused before approval waits and at task end, resumed on demand, and killed for
  browsers at task end.
- Active seconds are metered per workspace. Cost is *estimated* only if `E2B_RATE_USD_PER_SECOND` is
  set, otherwise *unknown*.
- Orphan sweep: on startup and every 15 minutes the worker kills app-tagged sandboxes that no
  running or paused row claims. `pnpm cleanup:cloud --yes` does the same manually.
- Paths are relative to `/home/user/workspace`. Traversal, absolute paths, control characters and
  backslashes are rejected.

## Secrets

No API key, Composio credential or env var is injected into either sandbox. Commands receive only
the per-call request payload (`BCTL_REQ`).
