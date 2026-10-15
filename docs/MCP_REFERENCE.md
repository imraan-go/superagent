# LHOS MCP Tools — all 100, grouped

> Names verified from the live server (2026-10-15). Exact JSON-Schema for each comes
> from `GET /api/tools` at runtime — fetch that, don't guess arg shapes.

**Priority order when the agent needs information/action (teach the orchestrator):**
1. Direct API (`http_request` + vault/connectors) — fastest, most reliable
2. `browser_*` structured page access (Playwright on Linux Chrome; NOT Windows RDP)
3. OCR text (`screen_text`, `read_text`, `find_text`)
4. `observe()` combo (windows + text + small screenshot)
5. Scaled screenshot → 6. full screenshot (last resort)

## Observe / vision
`observe` · `desktop_screenshot` · `screen_text` · `read_text` · `find_text` ·
`wait_for_text` · `read_image` · `list_windows` · `desktop_screen_size` ·
`desktop_cursor` · `computer_info` · `capabilities`

## GUI computer-use (Linux desktop)
`desktop_click` · `desktop_double_click` · `desktop_right_click` · `desktop_move_mouse` ·
`desktop_scroll` · `desktop_key` · `desktop_type` · `desktop_batch` · `click_text` ·
`focus_window` · `maximize_window` · `desktop_launch` · `desktop_open` · `open_browser` ·
`wait` · `paste` · `get_clipboard` · `set_clipboard`

## Browser (Playwright/CDP — structured, Linux Chrome only)
`browser_start` · `browser_goto` · `browser_nav` · `browser_click` · `browser_fill` ·
`browser_fill_form` · `browser_press` · `browser_hover` · `browser_scroll` ·
`browser_wait` · `browser_act` · `browser_batch` · `browser_eval` · `browser_snapshot` ·
`browser_html` · `browser_text` · `browser_links` · `browser_table` · `browser_extract` ·
`browser_attr` · `browser_screenshot` · `browser_tabs` · `browser_new_tab` ·
`browser_switch_tab` · `browser_close_tab` · `browser_download` · `browser_upload`

## RDP (owner's Windows VPS)
`rdp_connect` (profiles! e.g. saved profile names via `rdp_profiles`) · `rdp_status` ·
`rdp_disconnect` · `rdp_open_url` · `rdp_new_tab` · `rdp_type` (OCR-verified; auto-
drafts >300 chars) · `rdp_hotkey` · `rdp_fetch` / `rdp_send` (file bridge via
`\\tsclient\agentshare` ↔ `~/persist/rdp-share`) · `rdp_profiles`
Password handling is out-of-band (login terminal on VNC / `~/persist/rdp_pass`) —
tools never take or return it.

## Shell / code / files
`run_command` (use `background:true` for long jobs) · `run_python` · `list_files` ·
`save_text` · `save_csv` · `share_file` (signed expiring download link) · `drive_upload`

## API plane
`http_request` (SSRF-guarded REST calls, vault-injected auth) · `secret_list` ·
`secret_delete` · `secret_intake_url` (returns human URL to add a key — never the key) ·
`connector_list` · `connector_save`

## Workflows / skills / scheduling / triggers
`workflow_run` · `workflow_save` · `workflow_list` · `workflow_get` ·
`workflow_run_saved` · `schedule_create` · `schedule_list` · `schedule_enable` ·
`schedule_delete` · `schedule_run_now` · `trigger_url` (webhook trigger links)

## Human-in-the-loop
`ask_user` · `request_takeover` (→ panel must pop the VNC computer view) · `hitl_check`

## Ops / maintenance
`session_report` · `maintenance_status` · `maintenance_run_now` · `snapshot_list` ·
`snapshot_prune` (prune is policy-disabled — surface as read-only in Manage) ·
`set_pace` (`fast` | `careful` — plain rate limiting)

## Gotchas (learned the hard way — keep)
- `browser_*` cannot see inside the Windows RDP session; use rdp_* + OCR there.
- Inside RDP, enter ALL text with `rdp_type`; navigate with `rdp_open_url`.
- Desktop may be recreating/restoring for 30–60 s — `desk` liveness errors are
  retryable, show "computer waking" state.
- Screenshots are expensive; prefer `observe` and OCR-first flows.
- `set_pace('careful')` before long multi-action sessions on owner accounts.
