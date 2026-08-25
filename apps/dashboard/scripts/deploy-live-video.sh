#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

echo "Enter each value at Wrangler's hidden prompt."

for secret in   LIVEKIT_API_KEY   LIVEKIT_API_SECRET   ZOOM_ACCOUNT_ID   ZOOM_CLIENT_ID   ZOOM_CLIENT_SECRET
do
  echo "=== $secret ==="
  npx --yes wrangler@4 secret put "$secret" --config wrangler.toml
done

echo "=== DEPLOY EVERYTHING BUILT CUSTOM LIVE VIDEO ==="
npx --yes wrangler@4 deploy --config wrangler.toml --keep-vars
