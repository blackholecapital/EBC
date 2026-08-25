from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .config import Settings


@dataclass(frozen=True)
class Speech:
    samples: np.ndarray
    sample_rate: int


class ChatterboxSpeech:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = None
        self._load_lock = asyncio.Lock()
        self._synthesis_lock = asyncio.Lock()
        self._speech_cache: dict[tuple[str, str], Speech] = {}
        self._voice_conditionals: dict[str, Any] = {}
        self._active_voice: str | None = None

    @property
    def ready(self) -> bool:
        return self.model is not None

    async def load(self) -> None:
        if self.settings.tts_backend == "disabled" or self.model is not None:
            return
        async with self._load_lock:
            if self.model is not None:
                return
            from chatterbox.tts_turbo import ChatterboxTurboTTS

            self.model = await asyncio.to_thread(
                lambda: ChatterboxTurboTTS.from_pretrained(device=self.settings.tts_device)
            )

            # Warm the default voice and short prefaces. Other voices are prepared lazily.
            async with self._synthesis_lock:
                default_voice = self.settings.resolve_voice_id(self.settings.tts_default_voice)
                await asyncio.to_thread(self._activate_voice, default_voice)
                for text in (part.strip() for part in self.settings.tts_preface_texts.split("|")):
                    if text:
                        self._speech_cache[(default_voice, text)] = await asyncio.to_thread(
                            self._generate_active, text
                        )

    def _activate_voice(self, voice_id: str | None) -> str:
        if self.model is None:
            raise RuntimeError("Chatterbox model is not loaded")
        resolved, reference = self.settings.voice_reference_for(voice_id)
        if self._active_voice == resolved and self.model.conds is not None:
            return resolved

        cached = self._voice_conditionals.get(resolved)
        if cached is not None:
            self.model.conds = cached
            self._active_voice = resolved
            return resolved

        self.model.prepare_conditionals(
            str(reference),
            exaggeration=self.settings.tts_exaggeration,
        )
        if self.model.conds is None:
            raise RuntimeError(f"Chatterbox did not prepare voice profile '{resolved}'")
        # Chatterbox replaces self.conds when prepare_conditionals runs, so retaining
        # each resulting object lets one loaded model swap voices without reloading weights.
        self._voice_conditionals[resolved] = self.model.conds
        self._active_voice = resolved
        return resolved

    def _generate_active(self, text: str) -> Speech:
        kwargs = {
            "exaggeration": self.settings.tts_exaggeration,
            "cfg_weight": self.settings.tts_cfg_weight,
        }
        waveform = self.model.generate(text, **kwargs)
        if hasattr(waveform, "detach"):
            waveform = waveform.detach().cpu().numpy()
        sample_rate = int(getattr(self.model, "sr", self.settings.tts_sample_rate))
        return Speech(samples=np.asarray(waveform, dtype=np.float32).squeeze(), sample_rate=sample_rate)

    async def synthesize(self, text: str, voice_id: str | None = None) -> Speech:
        if self.settings.tts_backend == "disabled":
            raise RuntimeError("TTS is disabled")
        await self.load()
        clean = str(text).strip()
        if not clean:
            raise RuntimeError("TTS text is empty")
        resolved = self.settings.resolve_voice_id(voice_id)
        cached = self._speech_cache.get((resolved, clean))
        if cached is not None:
            return cached

        # Chatterbox stores the active speaker conditionals on the model instance.
        # Serializing activation + generation prevents concurrent tenants from crossing voices.
        async with self._synthesis_lock:
            resolved = await asyncio.to_thread(self._activate_voice, resolved)
            speech = await asyncio.to_thread(self._generate_active, clean)
        return speech

    def status(self) -> dict:
        try:
            resolved, reference = self.settings.voice_reference_for(self.settings.tts_default_voice)
            configured = reference.exists()
        except RuntimeError:
            resolved = self.settings.resolve_voice_id(self.settings.tts_default_voice)
            reference = Path(self.settings.voice_root_path) / resolved / "reference.wav"
            configured = False
        return {
            "backend": self.settings.tts_backend,
            "device": self.settings.tts_device,
            "loaded": self.ready,
            "defaultVoice": resolved,
            "activeVoice": self._active_voice,
            "availableVoices": self.settings.available_voice_ids(),
            "preparedVoices": sorted(self._voice_conditionals.keys()),
            "voiceReferenceConfigured": configured,
            "voiceReference": str(reference),
        }
