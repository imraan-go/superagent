#!/usr/bin/env bash
# Build + (re)deploy tj-lhos-panel on THIS host as a systemd service.
#
# Why host and not Docker: the host bridge (e2b-agent-vm/bin/host_bridge.py) is
# loopback-only by design, so the panel must run on the host network. The
# Dockerfile stays for moving to another server later.
#
# Layout:
#   /opt/tj-lhos-panel/build      clean copy of the repo used for `next build`
#   /opt/tj-lhos-panel/releases/<ts>   standalone bundle (+ static, public, config, migrations)
#   /opt/tj-lhos-panel/current -> releases/<ts>   (atomic symlink swap)
#   /var/lib/tj-lhos-panel/uploads     uploaded files (persist across releases)
# Runs as unprivileged user `panel`; env comes from the repo's .env.local via
# systemd EnvironmentFile (read by systemd as root, never world-readable).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BASE=/opt/tj-lhos-panel
TS=$(date +%Y%m%d-%H%M%S)
PORT="${PANEL_PORT:-3100}"

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -f "$REPO/.env.local" ] || { echo "missing $REPO/.env.local (run scripts/sync-env.sh)"; exit 1; }

id panel >/dev/null 2>&1 || useradd --system --home "$BASE" --shell /usr/sbin/nologin panel
mkdir -p "$BASE/releases" /var/lib/tj-lhos-panel/uploads
chown -R panel:panel /var/lib/tj-lhos-panel

echo "== sync source"
rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude .claude --exclude /uploads \
  --exclude /test-results --exclude /playwright-report "$REPO/" "$BASE/build/"
cd "$BASE/build"
echo "== install deps (npm ci)"
npm ci --no-audit --no-fund --loglevel=error
echo "== migrate database"
node --env-file="$REPO/.env.local" --import tsx src/server/db/migrate.ts
echo "== build"
set -a; . "$REPO/.env.local"; set +a
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048 npm run build

REL="$BASE/releases/$TS"
mkdir -p "$REL"
cp -a .next/standalone/. "$REL/"
mkdir -p "$REL/.next" && cp -a .next/static "$REL/.next/static"
[ -d public ] && cp -a public "$REL/public"
cp -a config "$REL/config"
# LHOS operator guide: single source of truth lives in the agent-computer repo
[ -f /root/e2b-agent-vm/docs/SYSTEM_PROMPT.md ] && cp /root/e2b-agent-vm/docs/SYSTEM_PROMPT.md "$REL/config/agent-guide.md"
cp -a src/server/db/migrations "$REL/migrations"
chown -R panel:panel "$REL"
ln -sfn "$REL" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"

cat > /etc/systemd/system/tj-lhos-panel.service <<EOF
[Unit]
Description=tj-lhos-panel (Next.js personal super-agent dashboard)
After=network-online.target docker.service e2b-host-bridge.service
Wants=e2b-host-bridge.service

[Service]
Type=simple
User=panel
Group=panel
WorkingDirectory=$BASE/current
EnvironmentFile=$REPO/.env.local
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
Environment=UPLOAD_DIR=/var/lib/tj-lhos-panel/uploads
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/tj-lhos-panel
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable tj-lhos-panel >/dev/null 2>&1
systemctl restart tj-lhos-panel
echo "== waiting for health"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then echo "healthy: $REL"; break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "NOT healthy — journalctl -u tj-lhos-panel"; exit 1; }
# keep the last 3 releases
ls -1dt "$BASE"/releases/* | tail -n +4 | xargs -r rm -rf
