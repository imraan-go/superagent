#!/usr/bin/env bash
# Fill .env.local with live LHOS tokens read straight from the agent server's
# secrets files — so credentials never pass through chat, code, or docs.
# Idempotent: updates only the managed keys, preserves everything else.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=/root/e2b-agent-vm/secrets
E2B_KEY_FILE=/root/e2b-install/secrets/team_api_key
ENVF=.env.local

[ -f "$ENVF" ] || cp .env.example "$ENVF"

put() { # put KEY FILE
  local key=$1 file=$2 val
  [ -s "$file" ] || { echo "  !! missing $file (skipped $key)"; return; }
  val=$(tr -d '\n' < "$file")
  if grep -q "^${key}=" "$ENVF"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENVF"
  else
    echo "${key}=${val}" >> "$ENVF"
  fi
  echo "  ok ${key} (${#val} chars)"
}

echo "sync-env → $ENVF"
put LHOS_MCP_TOKEN      "$SRC/mcp_token"
put LHOS_APPROVE_TOKEN  "$SRC/approve_token"
put E2B_API_KEY         "$E2B_KEY_FILE"

grep -Eq '^PANEL_SECRET_KEY=[^ #]+' "$ENVF" || {
  sed -i "s|^PANEL_SECRET_KEY=.*|PANEL_SECRET_KEY=$(openssl rand -base64 32)|" "$ENVF"
  echo "  ok PANEL_SECRET_KEY (generated)"
}
chmod 600 "$ENVF"
echo "done. (.env.local is gitignored — keep it that way)"
