# Manage Mode — E2B / LHOS system dashboard

Navbar switch **Agent ⇄ Manage** flips the whole workspace to system administration
for the self-hosted E2B + agent stack. Amber accent theme variant. Layout: left rail
(sections) · main grid · right column (live stats).

## Sections

### 1. Overview
- Service cards (from host bridge `systemctl is-active` + uptime): `e2b-infra`,
  `e2b-api`, `e2b-orchestrator`, `e2b-client-proxy`, `e2b-firewall`,
  `e2b-desktop-vnc`, `e2b-mcp`, `e2b-scheduler`, `caddy`.
  Each: status dot, restart button (hold-to-confirm), last 3 log lines on hover.
- Desktop card: sandbox id, mode (fresh/resumed/restored-from-snapshot), uptime,
  resolution, buttons **Sleep / Wake / New desktop** (manage.sh verbs), VNC quick-open.
- Host stats (5 s poll): CPU, RAM, swap, disk % (warn ≥80, crit ≥90 — tokens amber/danger),
  per-service RSS. Readout components, sparklines (last 30 min in memory).

### 2. Activity & Reports
- Events feed: `GET /api/events` (filter by tool/ok/client; infinite scroll).
- **Generated reports browser:** lists `logs/*.md` daily reports via `GET
  /api/report?date=` + a date picker; rendered as markdown; "Generate now" button
  → `POST /api/tools/session_report`.

### 3. Persistent data (file manager)
- Browse guest `~/persist` via `POST /api/tools/list_files`; download via
  `share_file` (signed link); upload via panel → `save_text`/`rdp_send` path.
- Show host-mirror size + last sync time. Protected paths (rdp_pass, chrome-cdp)
  visible but not downloadable; never render secret file contents.

### 4. Snapshots
- `snapshot_list` table (id, age, size). Prune stays **disabled** (incident
  2026-10: diff-layer chain corruption) — show the toggle locked-off with the reason.

### 5. Schedules & maintenance
- LHOS `schedule_list` with enable/disable/run-now; `maintenance_status` +
  `maintenance_run_now`. fs-prune visible; snapshot-prune shown disabled.

### 6. System settings
- Config viewer: `config.env` keys with values **masked** (show key + length only),
  edit NOT allowed from UI (doc link explains how to edit on host).
- Token rotation: button → runs `manage.sh rotate-auth` via host bridge, then
  forces `scripts/sync-env.sh` + panel restart prompt. Firewall `lock-ip` form.
- Panel's own ops: restart panel container, DB backup-now, log level.

### 7. Logs
- journalctl viewer per unit (last 200 lines, follow via SSE), grep filter box.

## Host bridge rules (critical)
All Manage actions go through `src/server/manage/allowlist.ts` — a fixed map of
UI action → exact command. No free-form shell ever. Mutating actions require
hold-to-confirm in UI + audit row (`audit` table: who=owner, action, ts, result).
