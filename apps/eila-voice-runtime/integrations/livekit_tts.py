from __future__ import annotations

import os

import aiohttp

from livekit.agents import APIConnectOptions, tts, utils
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS


class EilaRuntimeTTS(tts.TTS):
    """LiveKit TTS provider backed by the shared EILA Chatterbox runtime."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        voice_id: str = "eila",
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24000,
            num_channels=1,
        )
        self.base_url = (base_url or os.environ.get("EILA_RUNTIME_URL", "")).rstrip("/")
        self.token = token or os.environ.get("EILA_RUNTIME_TOKEN", "")
        self.voice_id = voice_id
        if not self.base_url:
            raise ValueError("EILA_RUNTIME_URL is required")
        if not self.token:
            raise ValueError("EILA_RUNTIME_TOKEN is required")

    @property
    def provider(self) -> str:
        return "EILA Runtime"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> EilaChunkedStream:
        return EilaChunkedStream(
            tts=self,
            input_text=text,
            conn_options=conn_options,
        )

    async def aclose(self) -> None:
        return None


class EilaChunkedStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: EilaRuntimeTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(
            tts=tts,
            input_text=input_text,
            conn_options=conn_options,
        )
        self.runtime = tts

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        session = utils.http_context.http_session()
        timeout = aiohttp.ClientTimeout(total=120, sock_connect=self._conn_options.timeout)
        async with session.post(
            f"{self.runtime.base_url}/tts/livekit",
            headers={
                "content-type": "application/json",
                "x-runtime-token": self.runtime.token,
            },
            json={"text": self._input_text, "voiceId": self.runtime.voice_id},
            timeout=timeout,
        ) as response:
            if response.status != 200:
                detail = await response.text()
                raise RuntimeError(
                    f"EILA runtime TTS failed ({response.status}): {detail[:300]}"
                )

            output_emitter.initialize(
                request_id=utils.shortuuid(),
                sample_rate=24000,
                num_channels=1,
                mime_type="audio/pcm",
            )
            async for chunk in response.content.iter_chunked(16384):
                output_emitter.push(chunk)
