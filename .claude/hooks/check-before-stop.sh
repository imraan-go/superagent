#!/usr/bin/env bash
# Stop hook: when the working tree has uncommitted changes, run `pnpm check:changed` before
# Claude finishes. On failure Claude is sent back once to fix it (stop_hook_active prevents loops).
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0

active="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).stop_hook_active===true)}catch{console.log(false)}})')"
[ "$active" = "true" ] && exit 0
[ -n "$(git status --porcelain 2>/dev/null)" ] || exit 0

if ! out="$(pnpm -s check:changed 2>&1)"; then
  printf 'pnpm check:changed failed. Fix these before finishing:\n%s\n' "$(printf '%s\n' "$out" | tail -60)" >&2
  exit 2
fi
exit 0
