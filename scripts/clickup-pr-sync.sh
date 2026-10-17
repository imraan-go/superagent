#!/usr/bin/env bash
# Moves the ClickUp tickets a closed PR links to their final status: merged → shipped,
# closed without merging → cancelled. Run by .github/workflows/clickup-sync.yml.
#
# A ticket is any https://app.clickup.com/t/<id> link (or CU-<id>) in the PR title, body or branch
# name. Closing a PR without merging leaves tickets that are already shipped or cancelled alone, so
# closing a superseded PR doesn't cancel a ticket another PR shipped.
#
# Env: PR_MERGED (true|false), PR_NUMBER, PR_URL, PR_TITLE, PR_BODY, PR_BRANCH, CLICKUP_API_TOKEN.
# DRY_RUN=1 prints what would change without calling ClickUp.
set -euo pipefail

api="https://api.clickup.com/api/v2"

if [ "${PR_MERGED:-}" = "true" ]; then
  target="shipped"
  note="Shipped: PR #${PR_NUMBER} was merged. ${PR_URL}"
else
  target="cancelled"
  note="Cancelled: PR #${PR_NUMBER} was closed without merging. ${PR_URL}"
fi

ids="$(
  printf '%s\n%s\n%s\n' "${PR_TITLE:-}" "${PR_BODY:-}" "${PR_BRANCH:-}" |
    grep -oE 'app\.clickup\.com/t/([0-9]+/)?[A-Za-z0-9]+|(^|[^A-Za-z0-9])CU-[a-z0-9]+' |
    sed -E 's#.*/##; s#.*CU-##' |
    sort -u || true
)"

if [ -z "$ids" ]; then
  echo "PR #${PR_NUMBER} links no ClickUp tickets; nothing to do."
  exit 0
fi

if [ "${DRY_RUN:-}" = "1" ]; then
  for id in $ids; do echo "would move $id to '$target'"; done
  exit 0
fi

if [ -z "${CLICKUP_API_TOKEN:-}" ]; then
  echo "::warning::CLICKUP_API_TOKEN secret is not set; skipping ClickUp sync for: $(echo $ids)"
  exit 0
fi

clickup() {
  local method="$1" path="$2" body="${3:-}"
  curl -sS --fail-with-body -X "$method" "$api$path" \
    -H "Authorization: $CLICKUP_API_TOKEN" -H "Content-Type: application/json" \
    ${body:+--data "$body"}
}

failed=0
for id in $ids; do
  if ! task="$(clickup GET "/task/$id")"; then
    echo "::warning::$id: could not read the ticket: $task"
    failed=1
    continue
  fi
  status="$(jq -r '.status.status' <<<"$task")"
  type="$(jq -r '.status.type' <<<"$task")"

  if [ "$status" = "$target" ]; then
    echo "$id: already '$target'."
    continue
  fi
  if [ "$target" = "cancelled" ] && { [ "$type" = "done" ] || [ "$type" = "closed" ]; }; then
    echo "$id: already finished ('$status'); leaving it."
    continue
  fi

  if ! out="$(clickup PUT "/task/$id" "$(jq -nc --arg s "$target" '{status: $s}')")"; then
    echo "::error::$id: could not move '$status' → '$target': $out"
    failed=1
    continue
  fi
  clickup POST "/task/$id/comment" "$(jq -nc --arg t "$note" '{comment_text: $t, notify_all: false}')" \
    >/dev/null || echo "::warning::$id: status changed but the comment failed."
  echo "$id: '$status' → '$target'."
done

exit "$failed"
