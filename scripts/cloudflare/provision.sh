#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRANGLER="$REPO_ROOT/scripts/cloudflare/wrangler.sh"
STATE_DIR="$REPO_ROOT/.wrangler"
STATE_FILE="$STATE_DIR/ebc-resource-ids.env"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN before provisioning}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID before provisioning}"

cd "$REPO_ROOT"
mkdir -p "$STATE_DIR"

json_item_id() {
  local item_name="$1"
  node -e '
    const fs = require("node:fs");
    const name = process.argv[1];
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed.result || parsed.databases || parsed.projects || []);
    const item = rows.find((row) => row.name === name || row.database_name === name || row.project_name === name);
    if (item) process.stdout.write(String(item.uuid || item.id || ""));
  ' "$item_name"
}

json_has_item() {
  local item_name="$1"
  node -e '
    const fs = require("node:fs");
    const name = process.argv[1];
    const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed.result || parsed.databases || parsed.projects || []);
    const found = rows.some((row) => row.name === name || row.database_name === name || row.project_name === name);
    process.stdout.write(found ? "yes" : "");
  ' "$item_name"
}

list_d1() {
  "$WRANGLER" d1 list --json
}

ensure_d1() {
  local database_name="$1"
  local database_id
  database_id="$(list_d1 | json_item_id "$database_name")"
  if [[ -z "$database_id" ]]; then
    "$WRANGLER" d1 create "$database_name" --location enam >&2
    database_id="$(list_d1 | json_item_id "$database_name")"
  fi
  if [[ -z "$database_id" ]]; then
    echo "Could not resolve D1 ID for $database_name" >&2
    exit 1
  fi
  printf '%s' "$database_id"
}

dashboard_id="$(ensure_d1 ebc-call-center-dashboard)"
events_id="$(ensure_d1 ebc-call-center-events)"

r2_list="$("$WRANGLER" r2 bucket list)"
if ! grep -Fq "ebc-call-center-archive" <<<"$r2_list"; then
  "$WRANGLER" r2 bucket create ebc-call-center-archive
fi

queue_list="$("$WRANGLER" queues list)"
for queue in \
  ebc-followup-jobs-dlq \
  ebc-communication-events-dlq \
  ebc-followup-jobs \
  ebc-communication-events; do
  if ! grep -Fq "$queue" <<<"$queue_list"; then
    "$WRANGLER" queues create "$queue"
  fi
done

pages_json="$("$WRANGLER" pages project list --json)"
if [[ -z "$(json_has_item ebc-call-center <<<"$pages_json")" ]]; then
  "$WRANGLER" pages project create ebc-call-center \
    --production-branch main \
    --compatibility-date 2026-08-25 \
    --compatibility-flag nodejs_compat
fi

{
  printf 'export EBC_DASHBOARD_D1_ID=%q\n' "$dashboard_id"
  printf 'export EBC_EVENTS_D1_ID=%q\n' "$events_id"
} > "$STATE_FILE"

export EBC_DASHBOARD_D1_ID="$dashboard_id"
export EBC_EVENTS_D1_ID="$events_id"
node "$REPO_ROOT/scripts/cloudflare/render-configs.mjs"

echo "EBC Cloudflare resources are ready."
echo "Non-secret D1 IDs were written to $STATE_FILE."
