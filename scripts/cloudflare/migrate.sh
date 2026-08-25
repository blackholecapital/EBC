#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRANGLER="$REPO_ROOT/scripts/cloudflare/wrangler.sh"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN before migrating}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID before migrating}"

cd "$REPO_ROOT"
"$WRANGLER" d1 execute ebc-call-center-dashboard --remote --yes \
  --file infra/d1/dashboard/0001_initial.sql
"$WRANGLER" d1 execute ebc-call-center-events --remote --yes \
  --file infra/d1/events/0001_initial.sql

echo "EBC D1 schema is current."
