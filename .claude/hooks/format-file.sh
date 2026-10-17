#!/usr/bin/env bash
# PostToolUse hook (Edit/Write): format the file Claude just changed and apply ESLint autofixes,
# so formatting never needs a second edit. Remaining lint errors are reported back to Claude.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0

file="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input?.file_path??"")}catch{console.log("")}})')"
[ -n "$file" ] && [ -f "$file" ] || exit 0
case "$file" in "$CLAUDE_PROJECT_DIR"/*) ;; /*) exit 0 ;; esac

pnpm -s exec prettier --write --ignore-unknown --log-level silent "$file" || true
case "$file" in
  *.ts | *.tsx | *.mjs | *.js)
    if ! out="$(pnpm -s exec eslint --fix --no-warn-ignored "$file" 2>&1)"; then
      printf 'ESLint errors remain in %s:\n%s\n' "$file" "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
