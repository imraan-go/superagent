#!/usr/bin/env bash
# Fast pre-commit check scoped to what changed since this branch left main (committed, staged,
# unstaged and untracked): Prettier and ESLint on the changed files, typecheck on the changed
# packages and their dependents, and only the unit/web tests affected by the changes.
# `pnpm check` runs the same steps on the whole repo; CI runs that.
set -euo pipefail
cd "$(dirname "$0")/.."

base_ref="${CHECK_BASE:-origin/main}"
git rev-parse --verify -q "$base_ref" >/dev/null || base_ref=main
base="$(git merge-base "$base_ref" HEAD)"

changed=()
while IFS= read -r f; do
  [ -f "$f" ] && changed+=("$f")
done < <({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)

if [ ${#changed[@]} -eq 0 ]; then
  echo "check:changed: nothing changed since $(git rev-parse --short "$base")."
  exit 0
fi
echo "check:changed: ${#changed[@]} file(s) changed since $(git rev-parse --short "$base")."

echo "› prettier"
pnpm -s exec prettier --check --ignore-unknown --log-level warn "${changed[@]}"

lintable=()
for f in "${changed[@]}"; do
  case "$f" in *.ts | *.tsx | *.mjs | *.js) lintable+=("$f") ;; esac
done
if [ ${#lintable[@]} -gt 0 ]; then
  echo "› eslint"
  pnpm -s exec eslint --no-warn-ignored "${lintable[@]}"
fi

echo "› typecheck"
pnpm -s -r --if-present --filter "...[$base]" typecheck
if printf '%s\n' "${changed[@]}" | grep -q '^scripts/'; then
  pnpm -s exec tsc -p tsconfig.scripts.json --noEmit
fi

echo "› tests"
pnpm -s exec vitest run --project unit --project web --changed "$base" --passWithNoTests
