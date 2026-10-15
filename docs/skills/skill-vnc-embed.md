# Skill: embed the live computer (VNC) with watch/takeover

**Goal:** Computer panel in right sidebar + full takeover sheet.

## Steps
1. iframe src = `env LHOS_VNC_URL` (`https://vnc.hostx.h22t.com/`). Panel MUST be
   served from `*.h22t.com` so the viewer's SameSite=Lax session cookie applies
   inside the iframe (same-site). Dev: use `panel-dev.hostx.h22t.com` via Caddy or
   accept sign-in-in-iframe.
2. Watch mode: absolutely-positioned transparent overlay div (pointer-events:auto)
   capturing input; iframe below. Status dot = ws connection heartbeat (poll
   `/api/tools/computer_info` 30 s for desktop alive).
3. Take control: hold-to-confirm 600 ms → remove overlay → amber border + "LIVE
   CONTROL" readout + Esc hint; log run_step type 'takeover'. Release → overlay back.
4. Expand: Motion layout animation from card → full-height sheet (chat dimmed).
5. First-use: if iframe lands on viewer sign-in, show "Connect computer view"
   button → window.open the viewer (owner signs in once with access code) →
   reload iframe.

## Gotchas
- Never proxy VNC traffic through Next.js; the viewer already handles WS + auth.
- Don't screenshot-poll as fallback in v1 (cost); if iframe is blocked, show a
  deep-link card instead.
- Keep iframe mounted (display:none) when panel collapsed — avoids reconnect churn;
  unmount after 10 min unused.
