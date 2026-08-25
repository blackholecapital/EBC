from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


def _integer(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


def _floating(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


def _boolean(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _duration(name: str, default: int | str) -> int | str:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return value


def _voice_id(value: str) -> str:
    clean = str(value or "").strip().lower()
    if not clean or not re.fullmatch(r"[a-z0-9_-]+", clean):
        raise RuntimeError(f"Invalid voice id: {value!r}")
    return clean


def _voice_aliases(value: str) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for item in str(value or "").split(","):
        item = item.strip()
        if not item:
            continue
        separator = "=" if "=" in item else ":" if ":" in item else None
        if not separator:
            raise RuntimeError(
                "EILA_TTS_VOICE_ALIASES entries must use alias=target or alias:target"
            )
        alias, target = item.split(separator, 1)
        aliases[_voice_id(alias)] = _voice_id(target)
    return aliases


@dataclass(frozen=True)
class Settings:
    runtime_token: str = os.getenv("EILA_RUNTIME_TOKEN", "")
    host: str = os.getenv("EILA_HOST", "0.0.0.0")
    port: int = _integer("EILA_PORT", 8000)
    log_level: str = os.getenv("EILA_LOG_LEVEL", "info")

    llm_provider: str = os.getenv("EILA_LLM_PROVIDER", "ollama")
    llm_base_url: str = os.getenv("EILA_LLM_BASE_URL", "http://127.0.0.1:11434")
    llm_model: str = os.getenv("EILA_LLM_MODEL", "qwen3.5:9b")
    llm_api_key: str = os.getenv("EILA_LLM_API_KEY", "")
    llm_timeout_seconds: float = _floating("EILA_LLM_TIMEOUT_SECONDS", 90.0)
    llm_think: bool = _boolean("EILA_LLM_THINK", False)
    llm_keep_alive: int | str = _duration("EILA_LLM_KEEP_ALIVE", -1)
    llm_temperature: float = _floating("EILA_LLM_TEMPERATURE", 0.4)
    llm_num_predict: int = _integer("EILA_LLM_NUM_PREDICT", 96)
    llm_num_ctx: int = _integer("EILA_LLM_NUM_CTX", 4096)

    tts_backend: str = os.getenv("EILA_TTS_BACKEND", "chatterbox")
    tts_device: str = os.getenv("EILA_TTS_DEVICE", "cuda")
    # Legacy single-reference setting. Kept as a fallback for existing installs.
    tts_voice_reference: str = os.getenv(
        "EILA_TTS_VOICE_REFERENCE", "assets/voices/eila/reference.wav"
    )
    tts_voice_root: str = os.getenv("EILA_TTS_VOICE_ROOT", "assets/voices")
    tts_default_voice: str = os.getenv("EILA_TTS_DEFAULT_VOICE", "eila")
    tts_voice_aliases: str = os.getenv("EILA_TTS_VOICE_ALIASES", "ace:eila")
    tts_sample_rate: int = _integer("EILA_TTS_SAMPLE_RATE", 24000)
    tts_exaggeration: float = _floating("EILA_TTS_EXAGGERATION", 0.0)
    tts_cfg_weight: float = _floating("EILA_TTS_CFG_WEIGHT", 0.0)
    tts_preface_texts: str = os.getenv(
        "EILA_TTS_PREFACE_TEXTS",
        "Got it.|Absolutely.|Glad to hear it.|I'm doing great, thank you.",
    )

    telephony_sample_rate: int = _integer("EILA_TELEPHONY_SAMPLE_RATE", 8000)
    audio_chunk_ms: int = _integer("EILA_AUDIO_CHUNK_MS", 100)
    phrase_min_words: int = _integer("EILA_PHRASE_MIN_WORDS", 2)
    phrase_target_words: int = _integer("EILA_PHRASE_TARGET_WORDS", 6)
    phrase_max_words: int = _integer("EILA_PHRASE_MAX_WORDS", 18)
    phrase_first_max_words: int = _integer("EILA_PHRASE_FIRST_MAX_WORDS", 6)

    # Optional MuseTalk adapter. Requests remain voice-only unless they include
    # avatarId, even when the adapter is configured.
    avatar_runtime_url: str = os.getenv("EILA_AVATAR_RUNTIME_URL", "")
    avatar_runtime_token: str = os.getenv("EILA_AVATAR_RUNTIME_TOKEN", "")
    avatar_runtime_token_file: str = os.getenv("EILA_AVATAR_RUNTIME_TOKEN_FILE", "")
    avatar_timeout_seconds: float = _floating("EILA_AVATAR_TIMEOUT_SECONDS", 20.0)

    @property
    def voice_reference_path(self) -> Path:
        path = Path(self.tts_voice_reference)
        return path if path.is_absolute() else Path.cwd() / path

    @property
    def voice_root_path(self) -> Path:
        path = Path(self.tts_voice_root)
        return path if path.is_absolute() else Path.cwd() / path

    @property
    def voice_alias_map(self) -> dict[str, str]:
        return _voice_aliases(self.tts_voice_aliases)

    def resolve_voice_id(self, voice_id: str | None = None) -> str:
        requested = _voice_id(voice_id or self.tts_default_voice)
        aliases = self.voice_alias_map
        seen: set[str] = set()
        while requested in aliases:
            if requested in seen:
                raise RuntimeError("Voice alias cycle detected")
            seen.add(requested)
            requested = aliases[requested]
        return requested

    def voice_reference_for(self, voice_id: str | None = None) -> tuple[str, Path]:
        resolved = self.resolve_voice_id(voice_id)
        candidate = self.voice_root_path / resolved / "reference.wav"
        if candidate.exists():
            return resolved, candidate

        # Backward-compatible fallback for older single-reference deployments.
        default_resolved = self.resolve_voice_id(self.tts_default_voice)
        legacy = self.voice_reference_path
        if resolved == default_resolved and legacy.exists():
            return resolved, legacy

        raise RuntimeError(
            f"Voice profile '{resolved}' is missing reference.wav under {self.voice_root_path}"
        )

    def available_voice_ids(self) -> list[str]:
        root = self.voice_root_path
        voices: set[str] = set()
        if root.exists():
            for child in root.iterdir():
                if child.is_dir() and (child / "reference.wav").exists():
                    try:
                        voices.add(_voice_id(child.name))
                    except RuntimeError:
                        continue
        try:
            default_resolved = self.resolve_voice_id(self.tts_default_voice)
            if self.voice_reference_path.exists():
                voices.add(default_resolved)
        except RuntimeError:
            pass
        return sorted(voices)

    @property
    def resolved_avatar_runtime_token(self) -> str:
        direct = self.avatar_runtime_token.strip()
        if direct:
            return direct
        token_file = self.avatar_runtime_token_file.strip()
        if not token_file:
            return ""
        path = Path(token_file)
        if not path.is_absolute():
            path = Path.cwd() / path
        try:
            return path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    @property
    def avatar_enabled(self) -> bool:
        return bool(self.avatar_runtime_url.strip() and self.resolved_avatar_runtime_token)

    def validate(self) -> None:
        if not self.runtime_token:
            raise RuntimeError("EILA_RUNTIME_TOKEN is required")
        if self.llm_provider not in {"ollama", "openai-compatible"}:
            raise RuntimeError("EILA_LLM_PROVIDER must be ollama or openai-compatible")
        if self.tts_backend not in {"chatterbox", "disabled"}:
            raise RuntimeError("EILA_TTS_BACKEND must be chatterbox or disabled")
        if self.tts_backend != "disabled":
            self.voice_reference_for(self.tts_default_voice)
        if self.telephony_sample_rate != 8000:
            raise RuntimeError("Twilio output currently requires EILA_TELEPHONY_SAMPLE_RATE=8000")
        if self.avatar_runtime_url.strip() and not self.resolved_avatar_runtime_token:
            raise RuntimeError(
                "EILA_AVATAR_RUNTIME_URL requires EILA_AVATAR_RUNTIME_TOKEN or "
                "EILA_AVATAR_RUNTIME_TOKEN_FILE"
            )
