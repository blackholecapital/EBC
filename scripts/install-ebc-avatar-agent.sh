#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root inside AI-Linux." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_dir="${repo_root}/apps/livekit-avatar-agent"
env_file="${app_dir}/.env"
service_name="ebc-avatar.service"
service_file="/etc/systemd/system/${service_name}"
service_user="${EBC_AVATAR_USER:-daddy}"
log_dir="${EBC_AVATAR_LOG_DIR:-/workspace/logs}"
log_file="${log_dir}/ebc-avatar.log"
source_env="${EBC_AVATAR_SOURCE_ENV:-}"

if ! command -v systemctl >/dev/null 2>&1 || [[ "$(ps -p 1 -o comm=)" != "systemd" ]]; then
  echo "AI-Linux must be running with systemd as PID 1." >&2
  exit 1
fi
if ! id "${service_user}" >/dev/null 2>&1; then
  echo "Service user does not exist: ${service_user}" >&2
  exit 1
fi

install -d -o "${service_user}" -g "$(id -gn "${service_user}")" "${log_dir}"
if [[ ! -f "${env_file}" ]]; then
  install -m 600 -o "${service_user}" -g "$(id -gn "${service_user}")" "${app_dir}/.env.example" "${env_file}"
fi

upsert_env() {
  local key="$1" value="$2" escaped
  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  if grep -q "^${key}=" "${env_file}"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "${env_file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
  fi
}

copy_env_value() {
  local key="$1" source_key="${2:-$1}" value
  [[ -n "${source_env}" && -f "${source_env}" ]] || return 0
  value="$(sed -n "s/^${source_key}=//p" "${source_env}" | tail -1)"
  [[ -n "${value}" ]] || return 0
  upsert_env "${key}" "${value}"
}

for key in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET LOCAL_LLM_BASE_URL LOCAL_LLM_MODEL LOCAL_LLM_TEMPERATURE LIVEKIT_STT_MODEL; do
  copy_env_value "${key}"
done
upsert_env AGENT_NAME ebc-avatar
upsert_env AGENT_HTTP_PORT 8093
upsert_env EBC_VIDEO_RELAY_URL https://ebc-video-worker.cryptocapitalgroupfl.workers.dev/internal/lemonslice/sessions

for key in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET LOCAL_LLM_BASE_URL LOCAL_LLM_MODEL; do
  value="$(sed -n "s/^${key}=//p" "${env_file}" | tail -1)"
  if [[ -z "${value}" ]]; then
    echo "Missing ${key} in ${env_file}" >&2
    exit 1
  fi
done

chown "${service_user}:$(id -gn "${service_user}")" "${env_file}"
chmod 600 "${env_file}"
if [[ ! -x "${app_dir}/.venv/bin/python" ]]; then
  runuser -u "${service_user}" -- python3 -m venv "${app_dir}/.venv"
fi
runuser -u "${service_user}" -- "${app_dir}/.venv/bin/python" -m pip install --upgrade pip
runuser -u "${service_user}" -- "${app_dir}/.venv/bin/python" -m pip install "${app_dir}"

cat > "${service_file}" <<UNIT
[Unit]
Description=Everything Built Custom LiveKit Avatar Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${app_dir}
EnvironmentFile=${env_file}
ExecStart=${app_dir}/bin/start.sh
Restart=always
RestartSec=3
StandardOutput=append:${log_file}
StandardError=append:${log_file}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${service_name}"
for _ in $(seq 1 20); do
  if systemctl is-active --quiet "${service_name}" && ss -H -ltn "sport = :8093" 2>/dev/null | grep -q ':8093'; then
    break
  fi
  sleep 1
done
"${app_dir}/bin/health.sh"
echo "EBC avatar agent installed from ${app_dir}."
echo "Logs: ${log_file}"
