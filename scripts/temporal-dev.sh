#!/usr/bin/env bash
# Local Temporal dev server with PERSISTED state in .local/temporal.db (gitignored).
# Stopping this process keeps workflows, schedules and history. Deleting .local/temporal.db is a
# reset (use `pnpm infra:reset`, which asks for confirmation).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
if ! command -v temporal >/dev/null 2>&1; then
  echo "Temporal CLI not found. Install it: brew install temporal  (https://docs.temporal.io/cli)" >&2
  exit 1
fi
exec temporal server start-dev \
  --ip 127.0.0.1 \
  --port 7233 \
  --ui-port 8233 \
  --db-filename .local/temporal.db \
  --namespace default \
  --log-level warn
