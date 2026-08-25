#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRANGLER="$REPO_ROOT/scripts/cloudflare/wrangler.sh"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN before configuring secrets}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID before configuring secrets}"

cd "$REPO_ROOT"

put_secret() {
  local config="$1"
  local key="$2"
  local value="$3"
  printf '%s' "$value" | "$WRANGLER" secret put "$key" --config "$config"
}

put_if_set() {
  local config="$1"
  local key="$2"
  local value="${!key:-}"
  if [[ -n "$value" ]]; then
    put_secret "$config" "$key" "$value"
    echo "Configured $key for $config"
  else
    echo "Skipped $key (environment variable is not set)"
  fi
}

if [[ -z "${INTERNAL_CALL_SECRET:-}" ]]; then
  INTERNAL_CALL_SECRET="$(openssl rand -hex 32)"
  export INTERNAL_CALL_SECRET
  echo "Generated a new shared INTERNAL_CALL_SECRET."
fi

for config in \
  apps/dashboard/wrangler.toml \
  apps/blackhole-concierge-worker/wrangler.toml \
  apps/voice-worker/wrangler.toml; do
  put_secret "$config" INTERNAL_CALL_SECRET "$INTERNAL_CALL_SECRET"
done

for key in ZOOM_ACCOUNT_ID ZOOM_CLIENT_ID ZOOM_CLIENT_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  put_if_set apps/dashboard/wrangler.toml "$key"
done

for key in DOCUSIGN_ACCOUNT_ID DOCUSIGN_INTEGRATION_KEY DOCUSIGN_USER_ID DOCUSIGN_RSA_PRIVATE_KEY DOCUSIGN_CONSENT_REDIRECT_URI; do
  put_if_set apps/blackhole-concierge-worker/wrangler.toml "$key"
done

for key in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_PHONE_NUMBER DEEPGRAM_API_KEY EILA_RUNTIME_TOKEN OPENAI_API_KEY; do
  put_if_set apps/voice-worker/wrangler.toml "$key"
done

for key in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_PHONE_NUMBER; do
  put_if_set apps/sms-worker/wrangler.toml "$key"
done

for key in RESEND_API_KEY FROM_EMAIL; do
  put_if_set apps/email-worker/wrangler.toml "$key"
done

echo "Secret sync finished. Skipped values remain unconfigured."
