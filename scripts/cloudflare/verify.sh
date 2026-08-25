#!/usr/bin/env bash
set -euo pipefail

urls=(
  "https://ebc-dashboard-worker.cryptocapitalgroupfl.workers.dev/api/health"
  "https://ebc-concierge-worker.cryptocapitalgroupfl.workers.dev/api/health"
  "https://ebc-voice-worker.cryptocapitalgroupfl.workers.dev/health"
  "https://ebc-sms-worker.cryptocapitalgroupfl.workers.dev/api/health"
  "https://ebc-email-worker.cryptocapitalgroupfl.workers.dev/api/health"
  "https://ebc-call-center.pages.dev/"
)

for url in "${urls[@]}"; do
  status="$(curl --silent --show-error --location --output /tmp/ebc-health-response \
    --write-out '%{http_code}' --max-time 20 "$url")"
  if [[ "$status" -lt 200 || "$status" -ge 400 ]]; then
    echo "FAIL $status $url" >&2
    sed -n '1,8p' /tmp/ebc-health-response >&2
    exit 1
  fi
  echo "PASS $status $url"
done

echo "EBC Cloudflare endpoints are reachable."
