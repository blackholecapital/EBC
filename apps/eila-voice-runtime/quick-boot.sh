#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${EILA_VENV_DIR:-$RUNTIME_DIR/.venv}"
PYTHON_BIN="${EILA_PYTHON_BIN:-python3}"
REQUIREMENTS_HASH_FILE="$VENV_DIR/.eila-requirements.sha256"
BLACKWELL_TORCH_VERSION="${EILA_BLACKWELL_TORCH_VERSION:-2.12.0}"
BLACKWELL_TORCHAUDIO_VERSION="${EILA_BLACKWELL_TORCHAUDIO_VERSION:-2.11.0}"
BLACKWELL_TORCH_INDEX_URL="${EILA_BLACKWELL_TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu130}"

cd "$RUNTIME_DIR"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

CURRENT_REQUIREMENTS_HASH="$(sha256sum requirements.txt | awk '{print $1}')"
INSTALLED_REQUIREMENTS_HASH="$(test -f "$REQUIREMENTS_HASH_FILE" && sed -n '1p' "$REQUIREMENTS_HASH_FILE" || true)"

if [ "$CURRENT_REQUIREMENTS_HASH" != "$INSTALLED_REQUIREMENTS_HASH" ]; then
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -r requirements.txt
  printf '%s\n' "$CURRENT_REQUIREMENTS_HASH" > "$REQUIREMENTS_HASH_FILE"
fi

# chatterbox-tts 0.1.7 currently pins torch/torchaudio 2.6.0. That binary does
# not contain kernels for RTX 50-series Blackwell (sm_120), causing startup to
# fail with "no kernel image is available for execution on the device". Keep
# Chatterbox itself, but repair only the PyTorch binary pair when the installed
# build cannot target the detected CUDA device.
TORCH_COMPAT="$($VENV_DIR/bin/python - <<'PY'
try:
    import torch
    if not torch.cuda.is_available():
        print("no-cuda")
    else:
        major, minor = torch.cuda.get_device_capability(0)
        target = f"sm_{major}{minor}"
        arch = set(torch.cuda.get_arch_list())
        print("repair" if major >= 12 and target not in arch else "ok")
except Exception:
    print("repair")
PY
)"

if [ "$TORCH_COMPAT" = "repair" ]; then
  echo "Detected Blackwell GPU with an incompatible PyTorch build; installing CUDA 13.0 PyTorch $BLACKWELL_TORCH_VERSION"
  "$VENV_DIR/bin/python" -m pip install --no-cache-dir --upgrade --force-reinstall \
    "torch==$BLACKWELL_TORCH_VERSION" \
    --index-url "$BLACKWELL_TORCH_INDEX_URL"
  "$VENV_DIR/bin/python" -m pip install --no-cache-dir --upgrade --force-reinstall --no-deps \
    "torchaudio==$BLACKWELL_TORCHAUDIO_VERSION" \
    --index-url "$BLACKWELL_TORCH_INDEX_URL"

  "$VENV_DIR/bin/python" - <<'PY'
import torch
print("torch", torch.__version__, "cuda", torch.version.cuda)
print("device", torch.cuda.get_device_name(0), "capability", torch.cuda.get_device_capability(0))
print("arch", torch.cuda.get_arch_list())
rnn = torch.nn.LSTM(16, 16, batch_first=True).cuda()
x = torch.randn(1, 4, 16, device="cuda")
y, _ = rnn(x)
torch.cuda.synchronize()
print("Blackwell CUDA/cuDNN RNN smoke test: OK", tuple(y.shape))
PY
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${EILA_RUNTIME_TOKEN:?Set EILA_RUNTIME_TOKEN in .env or the environment}"

exec "$VENV_DIR/bin/uvicorn" eila_runtime.server:app \
  --host "${EILA_HOST:-0.0.0.0}" \
  --port "${EILA_PORT:-8000}" \
  --log-level "${EILA_LOG_LEVEL:-info}"
