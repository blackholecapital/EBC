#!/usr/bin/env bash
set -euo pipefail

EBC_WORKSPACE_ROOT="${EBC_WORKSPACE_ROOT:-/mnt/eila-hot-sidecar/workspace/ebc}"
EBC_REPOSITORY_URL="${EBC_REPOSITORY_URL:-https://github.com/blackholecapital/EBC.git}"
EBC_REPOSITORY_DIR="$EBC_WORKSPACE_ROOT/repo"

mkdir -p "$EBC_WORKSPACE_ROOT"

if [[ ! -d "$EBC_REPOSITORY_DIR/.git" ]]; then
  git clone "$EBC_REPOSITORY_URL" "$EBC_REPOSITORY_DIR"
fi

cd "$EBC_REPOSITORY_DIR"
git fetch --prune origin
git checkout main
git pull --ff-only origin main

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" -lt 22 ]]; then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi

npm ci
npm --prefix apps/frontend ci

echo "EBC workspace is ready at $EBC_REPOSITORY_DIR"
