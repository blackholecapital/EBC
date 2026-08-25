#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRANGLER_BIN="$REPO_ROOT/node_modules/.bin/wrangler"

if [[ ! -x "$WRANGLER_BIN" ]]; then
  echo "Wrangler is not installed. Run 'npm ci' from $REPO_ROOT first." >&2
  exit 1
fi

# The sidecar can run without a writable home directory. Keep Wrangler's
# non-secret logs and cached configuration inside the ignored repository path.
export XDG_CONFIG_HOME="${EBC_XDG_CONFIG_HOME:-$REPO_ROOT/.wrangler-config}"
export WRANGLER_SEND_METRICS="false"
mkdir -p "$XDG_CONFIG_HOME"

exec "$WRANGLER_BIN" "$@"
