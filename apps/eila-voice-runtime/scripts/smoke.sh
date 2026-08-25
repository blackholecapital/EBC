#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${EILA_PUBLIC_URL:-http://127.0.0.1:${EILA_PORT:-8000}}"
: "${EILA_RUNTIME_TOKEN:?Set EILA_RUNTIME_TOKEN before running the smoke test}"

curl --fail --silent --show-error "$BASE_URL/health"
printf '\n'

curl --fail --silent --show-error \
  -H "x-runtime-token: $EILA_RUNTIME_TOKEN" \
  -H "content-type: application/json" \
  --data '{"text":"Hello, this is EBC AI from Everything Built Custom. How are you today?"}' \
  "$BASE_URL/v1/speech" | sed -n '1,5p'
