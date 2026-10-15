# Security review: pre-launch (2026-10-15)

Scope: the merged phases 0–5 on `master` before go-live at https://hostx.h22t.com.
Regression tests for everything below are in `tests/unit/security.test.ts`.

## Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | High | The tool allowlist was only applied to the schemas offered to the model. A call to any LHOS tool name the model was *not* offered (`trigger_url`, `secret_intake_url`, `schedule_create`, `run_command`…) was still sent to LHOS. | Fixed. `runCalls` refuses any name not offered this run (`guard.blockedToolReason`). Approved calls are re-checked too. |
| 2 | High | Checkpoint bypass by name: the default verb patterns matched only `_`-delimited names, so `sendEmail`, `gmail.send` and `Post-Tweet` were not gated. The `http_request` write-method gate used an exact name, so `mcp__x__http_request`, `HTTP_REQUEST` and `fetch_url` with POST were not gated either. External tools also ignored the owner's extra checkpoint patterns. | Fixed. Names are matched in a canonical form (`normalizeToolName`). Any http-style tool with a non-GET/HEAD/OPTIONS method is gated. `externalApproval` now takes the owner's patterns and the call's args. |
| 3 | High | SSRF: owner-entered MCP server and Pipedream URLs were fetched from the panel host without any address check, and redirects were followed. That made the host bridge (127.0.0.1:7071), Postgres and cloud metadata reachable. | Fixed. `lib/ssrf.assertPublicUrl` resolves DNS and blocks loopback, RFC1918, CGNAT, link-local, ULA, mapped v6 and multicast. Only the configured `LHOS_BASE_URL` origin is exempt. It runs on save and again at connect time (`mcpCredentials`, the Pipedream emit). Fetches use `redirect: "error"`. Custom-connector base URLs get the same check. |
| 4 | Medium | The login rate limit could be bypassed: `clientIp` used the *leftmost* X-Forwarded-For entry, which the client supplies. Rotating it reset the 5-failures/15-min budget. The webhook per-IP limiter had the same flaw. | Fixed. Both now use the rightmost entry, the one Caddy appends. |
| 5 | Medium | Memory DoS: `WindowLimiter` never evicted keys, so spoofed IPs grew the map without bound on a RAM-critical host. | Fixed. Stale keys are pruned, with a hard cap of 10k keys. |
| 6 | Medium | Prompt injection: tool results, uploaded file text and recalled memories reached the model undelimited. Third-party MCP/Composio tool descriptions and schemas were passed through raw (1000 chars). | Fixed. Each is wrapped in `<untrusted_data source=…>`, and attempts to close the wrapper early are neutralised. The system prompt states the untrusted-data rule. Descriptions are stripped of control/bidi characters and prompt-shaped markup and capped at 600 chars; schema descriptions are capped at 300. Webhook payloads were already wrapped. |
| 7 | Medium | Signed links could reach the model and logs. A `trigger_url`/`share_file` output or an error carrying `?token=` was stored in run steps, sent to the model, and could land in `audit` or logs. | Fixed. `lib/redact.redactSecrets` runs on every tool result and error text in the loop, on every audit row (`ops.ts`, `bridge.ts`) and on every logger value. Key-based redaction is kept as well. |
| 8 | Medium | There was no CSP or HSTS. | Fixed. A production CSP is set in `next.config.ts` via `src/lib/security-headers.ts`: `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (Next bootstrap; no eval in prod), `connect-src 'self'`, `frame-src <LHOS_VNC_URL origin>`, `frame-ancestors 'none'`, `object-src 'none'`. Also added: HSTS, COOP and CORP same-origin, and a tighter Permissions-Policy. |
| 9 | Low | Expensive owner routes had no rate limit. | Fixed. `lib/rate.enforceRateLimit` covers starting a run (20/min), key test (10/min), host actions such as wake, restart, maintenance and rotate-auth (6/min), and exports (6/min). Login (DB-backed) and webhooks (per-IP and per-hook) already had limits. |
| 10 | Info | Route gating. | Verified. Every route is `ownerRoute`/`getOwner` gated except health, auth/login, auth/logout and webhooks/[id] (HMAC). A test enumerates the route files. |
| 11 | Info | Approvals are human-only. | Verified. `decideApproval` (APPROVE_TOKEN) is called only from `api/approvals/[id]`. Bridge answer/done are called only from the HITL routes, which refuse `confirm`. Agent, automation and connector code never references any of these, and the model cannot call approval-named tools. Tests enforce all of this. |
| 12 | Info | Secrets in client bundles. | Verified. There is no `NEXT_PUBLIC_`. Client components only import pure server modules. Sealed secrets are never returned. Session cookie is `Secure` in production. |
| 13 | Info | Uploads. | No upload-serving route exists yet (`/api/uploads` is referenced but not implemented). When it is added it must send `Content-Disposition: attachment`, `nosniff` and a `sandbox` CSP. |
| 14 | Info | Dependencies. | `npm audit --omit=dev` reports 0 vulnerabilities. |
| 15 | Info | Anti-detection features. | None exist. A test greps for stealth, fingerprint-spoofing and captcha-solving code. |

## Remaining / platform-side
- `script-src 'unsafe-inline'` remains. A nonce pipeline in `proxy.ts` would remove it.
- Owner-entered LHOS-side URLs (custom connectors) are fetched by the agent computer. The VM must not be able to reach the host bridge on 127.0.0.1:7071 or the host's private ports. This is a firewall concern on the platform side.
- Make sure port 3100 is bound to loopback so that only Caddy can reach it. Otherwise X-Forwarded-For can be forged.
- The DNS check runs at validation time, so a DNS-rebinding window still exists between that check and the connect. `redirect: "error"` and the connect-time re-check narrow it.
