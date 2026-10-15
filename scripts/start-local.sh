#!/usr/bin/env bash
# Starts the whole local stack in the background: Postgres + MinIO (Docker), the persisted Temporal
# dev server, migrations, the worker, the API and the web app. Logs go to .local/logs/, PIDs to
# .local/pids/. Stop with `pnpm stop:all` (keeps all data).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local/logs .local/pids

[ -f .env ] || { echo "No .env — run: pnpm setup:env" >&2; exit 1; }

running() { [ -f ".local/pids/$1" ] && kill -0 "$(cat ".local/pids/$1")" 2>/dev/null; }
start() {
  local name=$1; shift
  if running "$name"; then echo "$name already running (pid $(cat ".local/pids/$name"))"; return; fi
  nohup "$@" >".local/logs/$name.log" 2>&1 &
  echo $! >".local/pids/$name"
  echo "started $name (pid $!, log .local/logs/$name.log)"
}
wait_port() {
  for _ in $(seq 1 60); do nc -z 127.0.0.1 "$1" 2>/dev/null && return 0; sleep 1; done
  echo "timed out waiting for port $1" >&2; return 1
}

pnpm infra:up
if nc -z 127.0.0.1 7233 2>/dev/null; then echo "temporal already listening on 7233"; else start temporal bash scripts/temporal-dev.sh; fi
wait_port 7233
pnpm db:migrate
start worker pnpm worker:dev
start api pnpm --filter @superagent/api dev
start web pnpm --filter @superagent/web dev
wait_port 3001
wait_port 3000
echo
echo "Ready: web http://localhost:3000 · API http://127.0.0.1:3001 · Temporal UI http://127.0.0.1:8233 (loopback only)"
