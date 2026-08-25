#!/usr/bin/env bash
set -euo pipefail

# EILA shared voice runtime bootstrap for disposable Vast.ai RTX 5090 compute.
# Canonical state remains on the Blackhole hot sidecar. This script expects the
# verified portable voice archive to have already been copied to the GPU host.

ARCHIVE="${1:-/workspace/eila-voice-portable-2026-08-17.tar}"
EXPECTED_SHA="3c4f8c983ebaae9b12efd2c4eb1f64cdb1448b3891be132d12028fef87358d9c"
STACK_ROOT="${EILA_STACK_ROOT:-/workspace/eila-stack}"
SEED_DIR="$STACK_ROOT/seed"
REPO_DIR="$STACK_ROOT/ebc-call-center"
RUNTIME_DIR="$REPO_DIR/apps/eila-voice-runtime"
VENV_DIR="$STACK_ROOT/voice-venv"
LOG_DIR="$STACK_ROOT/logs"
HF_HOME_DIR="$SEED_DIR/.cache/huggingface"
OLLAMA_MODELS_DIR="$SEED_DIR/ollama-persist/home/models"
ARCHIVED_REFERENCE="$SEED_DIR/ebc-call-center-eila/apps/eila-voice-runtime/assets/voices/alley/reference.wav"
ARCHIVED_ENV="$SEED_DIR/ebc-call-center-eila/apps/eila-voice-runtime/.env"
# Optional small directory copied separately from Blackhole. Layout:
# /workspace/voice-profiles/eila/reference.wav
# /workspace/voice-profiles/ace/reference.wav
VOICE_PROFILE_SEED="${EILA_VOICE_PROFILE_SEED:-/workspace/voice-profiles}"

say() { printf '\n=== %s ===\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$ARCHIVE" ] || die "Portable voice archive not found: $ARCHIVE"
mkdir -p "$SEED_DIR" "$LOG_DIR"

say "VERIFY PORTABLE ARCHIVE"
ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
echo "sha256: $ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "Archive SHA256 does not match the canonical Blackhole backup"
tar -tf "$ARCHIVE" >/dev/null

say "EXTRACT MODELS + VOICE SEED"
if [ ! -f "$STACK_ROOT/.seed-extracted" ]; then
  tar -xf "$ARCHIVE" -C "$SEED_DIR" \
    .cache/huggingface \
    ollama-persist/home/models \
    ebc-call-center-eila/apps/eila-voice-runtime/assets/voices/alley/reference.wav \
    ebc-call-center-eila/apps/eila-voice-runtime/.env
  touch "$STACK_ROOT/.seed-extracted"
fi

du -sh "$HF_HOME_DIR" "$OLLAMA_MODELS_DIR" 2>/dev/null || true

say "SYNC CURRENT EBC RUNTIME CODE"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin main
  git -C "$REPO_DIR" reset --hard origin/main
else
  rm -rf "$REPO_DIR"
  git clone --depth 1 https://github.com/blackholecapital/ebc-call-center.git "$REPO_DIR"
fi

say "INSTALL VOICE PROFILES"
mkdir -p "$RUNTIME_DIR/assets/voices/eila"
if [ -d "$VOICE_PROFILE_SEED" ]; then
  # Copy only profile directories/files, never secrets or model state.
  cp -a "$VOICE_PROFILE_SEED"/. "$RUNTIME_DIR/assets/voices/"
fi

# The archived EBC AI reference is a fallback only. A separately copied
# /workspace/voice-profiles/eila/reference.wav wins automatically.
if [ ! -f "$RUNTIME_DIR/assets/voices/eila/reference.wav" ]; then
  [ -f "$ARCHIVED_REFERENCE" ] || die "No EILA reference voice is available"
  cp -f "$ARCHIVED_REFERENCE" "$RUNTIME_DIR/assets/voices/eila/reference.wav"
fi

find "$RUNTIME_DIR/assets/voices" -maxdepth 2 -type f -name reference.wav -print

if [ -f "$ARCHIVED_ENV" ]; then
  cp -f "$ARCHIVED_ENV" "$RUNTIME_DIR/.env"
else
  cp -f "$RUNTIME_DIR/.env.example" "$RUNTIME_DIR/.env"
fi

# Rewrite only infrastructure settings. Preserve the archived runtime token so
# existing Cloudflare channel secrets can reconnect without a token rotation.
python3 - "$RUNTIME_DIR/.env" "$HF_HOME_DIR" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
hf_home = sys.argv[2]
updates = {
    "EILA_HOST": "0.0.0.0",
    "EILA_PORT": "8000",
    "EILA_LLM_PROVIDER": "ollama",
    "EILA_LLM_BASE_URL": "http://127.0.0.1:11434",
    "EILA_LLM_MODEL": "qwen3.5:9b",
    "EILA_LLM_KEEP_ALIVE": "-1",
    "EILA_TTS_BACKEND": "chatterbox",
    "EILA_TTS_DEVICE": "cuda",
    "EILA_TTS_VOICE_ROOT": "assets/voices",
    "EILA_TTS_DEFAULT_VOICE": "eila",
    "EILA_TTS_VOICE_ALIASES": "ace:eila",
    "EILA_TTS_VOICE_REFERENCE": "assets/voices/eila/reference.wav",
    "HF_HOME": hf_home,
}
lines = path.read_text().splitlines() if path.exists() else []
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out).rstrip() + "\n")
PY

RUNTIME_TOKEN="$(python3 - "$RUNTIME_DIR/.env" <<'PY'
from pathlib import Path
import sys
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith("EILA_RUNTIME_TOKEN="):
        print(line.split("=", 1)[1].strip().strip("'\""))
        break
PY
)"
[ -n "$RUNTIME_TOKEN" ] || die "EILA_RUNTIME_TOKEN missing from archived .env"

say "INSTALL/START OLLAMA"
if ! command -v ollama >/dev/null 2>&1; then
  command -v curl >/dev/null 2>&1 || die "curl is required to install Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi

if ! curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  nohup env \
    OLLAMA_MODELS="$OLLAMA_MODELS_DIR" \
    OLLAMA_HOST="127.0.0.1:11434" \
    ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
  echo $! > "$STACK_ROOT/ollama.pid"
fi

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:11434/api/version >/dev/null || die "Ollama did not become healthy"

OLLAMA_LIST="$(ollama list 2>/dev/null || true)"
echo "$OLLAMA_LIST"
echo "$OLLAMA_LIST" | grep -qi 'qwen3.5.*9b' || die "Preserved qwen3.5:9b model is not visible to Ollama"

say "START SHARED EILA VOICE RUNTIME"
if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "Runtime already healthy on port 8000"
else
  rm -f "$STACK_ROOT/runtime.pid"
  (
    cd "$RUNTIME_DIR"
    nohup env \
      EILA_VENV_DIR="$VENV_DIR" \
      HF_HOME="$HF_HOME_DIR" \
      ./quick-boot.sh >"$LOG_DIR/eila-voice-runtime.log" 2>&1 &
    echo $! > "$STACK_ROOT/runtime.pid"
  )
fi

# First boot may install Python/TTS dependencies, so allow a bounded warm-up.
for _ in $(seq 1 300); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
  sleep 2
done

if ! curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "--- runtime log tail ---" >&2
  tail -120 "$LOG_DIR/eila-voice-runtime.log" >&2 || true
  die "EILA voice runtime did not become healthy"
fi

say "HEALTH"
curl -fsS http://127.0.0.1:8000/health | python3 -m json.tool

say "LLM COMPATIBILITY TEST"
curl -fsS http://127.0.0.1:8000/chat \
  -H 'content-type: application/json' \
  -H "x-runtime-token: $RUNTIME_TOKEN" \
  -d '{"text":"Reply with exactly: EILA runtime online"}' \
  | python3 -m json.tool

say "EILA VOICE TEST"
curl -fsS http://127.0.0.1:8000/tts/twilio \
  -H 'content-type: application/json' \
  -H "x-runtime-token: $RUNTIME_TOKEN" \
  -d '{"text":"EILA voice runtime online.","voiceId":"eila"}' \
  -o "$STACK_ROOT/test-eila.mulaw"
ls -lh "$STACK_ROOT/test-eila.mulaw"

say "EBC ALIAS TEST"
curl -fsS http://127.0.0.1:8000/tts/twilio \
  -H 'content-type: application/json' \
  -H "x-runtime-token: $RUNTIME_TOKEN" \
  -d '{"text":"EBC voice routing online.","voiceId":"ace"}' \
  -o "$STACK_ROOT/test-ace.mulaw"
ls -lh "$STACK_ROOT/test-ace.mulaw"

say "GPU HEADROOM"
nvidia-smi || true

echo
echo "VOICE READY"
echo "Runtime: http://127.0.0.1:8000"
echo "Profiles: $RUNTIME_DIR/assets/voices"
echo "Logs:    $LOG_DIR/eila-voice-runtime.log"
echo "Ollama:  $LOG_DIR/ollama.log"
echo "Next: expose port 8000 on the Vast instance, then repoint the Cloudflare channel Workers to that public runtime URL."
