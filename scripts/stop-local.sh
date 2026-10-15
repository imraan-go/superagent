#!/usr/bin/env bash
# Stops everything started by start-local.sh. This is a normal stop: Postgres/MinIO volumes and
# .local/temporal.db are kept. Running workflows resume when the stack starts again.
set -euo pipefail
cd "$(dirname "$0")/.."

for name in web api worker temporal; do
  f=".local/pids/$name"
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    echo "stopped $name"
  fi
  rm -f "$f"
done
pnpm infra:stop
