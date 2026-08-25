from __future__ import annotations

import io
import re
import wave
from dataclasses import dataclass

import numpy as np

from .audio import pcm16
from .config import Settings


JOB_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")


@dataclass(frozen=True)
class AvatarJob:
    job_id: str
    status: str


def wav_payload(samples: np.ndarray, sample_rate: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm16(samples).tobytes())
    return output.getvalue()


class AvatarRuntime:
    def __init__(self, settings: Settings):
        self.settings = settings

    def status(self) -> dict:
        return {
            "configured": self.settings.avatar_enabled,
            "urlConfigured": bool(self.settings.avatar_runtime_url.strip()),
        }

    def _headers(self) -> dict[str, str]:
        token = self.settings.resolved_avatar_runtime_token
        if not self.settings.avatar_enabled or not token:
            raise RuntimeError("Avatar runtime is not configured")
        return {"x-avatar-token": token}

    def _url(self, path: str) -> str:
        return f"{self.settings.avatar_runtime_url.rstrip('/')}{path}"

    @staticmethod
    def validate_job_id(job_id: str) -> str:
        clean = str(job_id or "").strip().lower()
        if not JOB_ID_PATTERN.fullmatch(clean):
            raise ValueError("Invalid avatar job id")
        return clean

    async def render(
        self,
        samples: np.ndarray,
        sample_rate: int,
        *,
        avatar_id: str,
        session_id: str = "",
        tenant_id: str = "",
        assistant_name: str = "",
        voice_id: str = "",
    ) -> AvatarJob:
        import httpx

        audio = wav_payload(samples, sample_rate)
        data = {
            "sessionId": session_id,
            "tenantId": tenant_id,
            "assistantName": assistant_name,
            "voiceId": voice_id,
            "avatarId": avatar_id,
        }
        files = {"audio": ("response.wav", audio, "audio/wav")}
        async with httpx.AsyncClient(timeout=self.settings.avatar_timeout_seconds) as client:
            response = await client.post(
                self._url("/v1/renders"),
                headers=self._headers(),
                data=data,
                files=files,
            )
            response.raise_for_status()
            payload = response.json()
        job_id = self.validate_job_id(payload.get("jobId", ""))
        return AvatarJob(job_id=job_id, status=str(payload.get("status", "queued")))

    async def get_job(self, job_id: str) -> dict:
        import httpx

        clean = self.validate_job_id(job_id)
        async with httpx.AsyncClient(timeout=self.settings.avatar_timeout_seconds) as client:
            response = await client.get(
                self._url(f"/v1/renders/{clean}"), headers=self._headers()
            )
            response.raise_for_status()
            return response.json()

    async def get_video(self, job_id: str) -> tuple[bytes, str]:
        import httpx

        clean = self.validate_job_id(job_id)
        async with httpx.AsyncClient(timeout=self.settings.avatar_timeout_seconds) as client:
            response = await client.get(
                self._url(f"/v1/renders/{clean}/video"), headers=self._headers()
            )
            response.raise_for_status()
            return response.content, response.headers.get("content-type", "video/mp4")
