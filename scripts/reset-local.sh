#!/usr/bin/env bash
# DESTRUCTIVE RESET of local state: deletes the Postgres and MinIO volumes (all users, tasks,
# approvals, artifacts) and .local/temporal.db (all workflow history and schedules).
# Never run automatically. Requires typing the confirmation phrase interactively.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -t 0 ]; then
  echo "Refusing to reset without an interactive terminal." >&2
  exit 1
fi
echo "This permanently deletes ALL local data: Postgres + MinIO volumes and .local/temporal.db."
echo "E2B sandboxes are not touched (use 'pnpm cleanup:cloud')."
read -r -p "Type 'reset local data' to continue: " answer
if [ "$answer" != "reset local data" ]; then
  echo "Aborted; nothing was changed."
  exit 1
fi

bash scripts/stop-local.sh || true
docker compose -f infra/local/compose.yaml --env-file .env down -v
rm -f .local/temporal.db .local/temporal.db-shm .local/temporal.db-wal
echo "Local state reset. Next: pnpm start:all (or infra:up, temporal:dev, db:migrate, db:seed:dev)."
