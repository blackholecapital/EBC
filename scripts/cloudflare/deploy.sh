#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRANGLER="$REPO_ROOT/scripts/cloudflare/wrangler.sh"
STATE_FILE="$REPO_ROOT/.wrangler/ebc-resource-ids.env"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN before deploying}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID before deploying}"

cd "$REPO_ROOT"

if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

if [[ -n "${EBC_DASHBOARD_D1_ID:-}" && -n "${EBC_EVENTS_D1_ID:-}" ]]; then
  node scripts/cloudflare/render-configs.mjs
fi

if grep -Eq 'REPLACE_WITH_EBC_.*_D1_ID' apps/*/wrangler.toml; then
  echo "D1 IDs are not rendered. Run npm run cf:provision or set both EBC_*_D1_ID variables." >&2
  exit 1
fi

if grep -Eq 'name = "(blackhole|ace)-|service = "(blackhole|ace)-|queue = "(blackhole|ace)-|database_name = "(blackhole|ace)-' apps/*/wrangler.toml; then
  echo "Deployment guard failed: a non-EBC Cloudflare resource is referenced." >&2
  exit 1
fi

for config in \
  apps/sms-worker/wrangler.toml \
  apps/email-worker/wrangler.toml \
  apps/voice-worker/wrangler.toml \
  apps/video-worker/wrangler.toml \
  apps/blackhole-concierge-worker/wrangler.toml \
  apps/dashboard/wrangler.toml; do
  "$WRANGLER" deploy --config "$config"
done

npm --prefix apps/frontend run build
"$WRANGLER" pages deploy dist \
  --cwd apps/frontend \
  --project-name ebc-call-center \
  --branch main \
  --commit-dirty=true

echo "EBC Workers and Pages deployment completed."
