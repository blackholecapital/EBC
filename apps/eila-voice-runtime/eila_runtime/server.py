from __future__ import annotations

import hmac
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .audio import pcm16, resample, twilio_mulaw
from .config import Settings
from .engine import VoiceEngine
from .protocol import ndjson, request_id


settings = Settings()
settings.validate()
engine = VoiceEngine(settings)


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=24000)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    sessionId: str | None = None
    voiceId: str | None = None


class TurnRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=30000)
    sessionId: str | None = None
    tenantId: str | None = None
    assistantName: str | None = None
    voiceId: str | None = None
    avatarId: str | None = Field(default=None, pattern=r"^[a-z0-9_-]+$")
    metadata: dict = Field(default_factory=dict)
    preface: str | None = Field(default=None, max_length=80)


def authorize(token: str | None) -> None:
    supplied = token or ""
    if not hmac.compare_digest(supplied, settings.runtime_token):
        raise HTTPException(status_code=401, detail="Invalid runtime token")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await engine.tts.load()
    yield


app = FastAPI(title="EILA Voice Runtime", version=__version__, lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "eila-voice-runtime",
        "version": __version__,
        "protocol": "ndjson-v1",
        "compatibility": {
            "chat": True,
            "legacyTwilioTts": True,
            "livekitPcmTts": True,
            "livekitStreamingPcmTts": True,
            "multiVoice": True,
        },
        "llm": {
            "provider": settings.llm_provider,
            "model": settings.llm_model,
            "baseUrlConfigured": bool(settings.llm_base_url),
        },
        "tts": engine.tts.status(),
        "avatar": engine.avatar.status(),
        "audio": {"encoding": "audio/x-mulaw", "sampleRate": 8000},
    }


@app.post("/chat")
async def compatible_chat(req: ChatRequest, x_runtime_token: str | None = Header(default=None)):
    authorize(x_runtime_token)
    return {"response": await engine.llm.complete(req.text)}


@app.post("/tts/twilio")
async def compatible_twilio_tts(
    req: SpeechRequest,
    x_runtime_token: str | None = Header(default=None),
):
    """Compatibility endpoint for older Buddy/Blackhole channel adapters."""
    authorize(x_runtime_token)
    speech = await engine.tts.synthesize(req.text, req.voiceId)
    payload = twilio_mulaw(speech.samples, speech.sample_rate)
    return Response(
        content=payload,
        media_type="audio/x-mulaw",
        headers={
            "x-eila-audio-encoding": "mulaw",
            "x-eila-sample-rate": "8000",
            "x-eila-voice-id": settings.resolve_voice_id(req.voiceId),
        },
    )


@app.post("/tts/livekit")
async def compatible_livekit_tts(
    req: SpeechRequest,
    x_runtime_token: str | None = Header(default=None),
):
    """Return full-quality 24 kHz mono PCM16 for LiveKit avatar pipelines."""
    authorize(x_runtime_token)
    speech = await engine.tts.synthesize(req.text, req.voiceId)
    sample_rate = 24000
    samples = resample(speech.samples, speech.sample_rate, sample_rate)
    payload = pcm16(samples).astype("<i2", copy=False).tobytes()
    return Response(
        content=payload,
        media_type="audio/pcm",
        headers={
            "x-eila-audio-encoding": "pcm_s16le",
            "x-eila-sample-rate": str(sample_rate),
            "x-eila-num-channels": "1",
            "x-eila-voice-id": settings.resolve_voice_id(req.voiceId),
        },
    )


@app.post("/tts/livekit/stream")
async def streaming_livekit_tts(
    req: SpeechRequest,
    request: Request,
    x_runtime_token: str | None = Header(default=None),
):
    """Stream phrase-progressive 24 kHz mono PCM16 in one HTTP response."""
    authorize(x_runtime_token)
    if not re.search(r"\w", req.text):
        raise HTTPException(status_code=422, detail="TTS text is empty")
    rid = request_id("livekit_tts")
    resolved_voice = settings.resolve_voice_id(req.voiceId)
    stream = engine.stream_livekit_speech(req.text, rid, resolved_voice)
    try:
        first_chunk = await anext(stream)
    except StopAsyncIteration as exc:
        await stream.aclose()
        raise HTTPException(status_code=422, detail="TTS produced no audio") from exc
    except Exception as exc:
        await stream.aclose()
        raise HTTPException(status_code=503, detail="TTS synthesis failed") from exc

    async def body():
        try:
            if not await request.is_disconnected():
                yield first_chunk
            async for audio_chunk in stream:
                if await request.is_disconnected():
                    break
                yield audio_chunk
        finally:
            await stream.aclose()

    return StreamingResponse(
        body(),
        media_type="audio/pcm",
        headers={
            "cache-control": "no-store",
            "x-accel-buffering": "no",
            "x-eila-request-id": rid,
            "x-eila-audio-encoding": "pcm_s16le",
            "x-eila-sample-rate": "24000",
            "x-eila-num-channels": "1",
            "x-eila-voice-id": resolved_voice,
        },
    )


@app.post("/v1/speech")
async def speech(req: SpeechRequest, x_runtime_token: str | None = Header(default=None)):
    authorize(x_runtime_token)
    rid = request_id("speech")

    async def body():
        async for item in engine.stream_speech(req.text, rid, voice_id=req.voiceId):
            yield ndjson(item)

    return StreamingResponse(body(), media_type="application/x-ndjson")


@app.post("/v1/turn")
async def turn(req: TurnRequest, x_runtime_token: str | None = Header(default=None)):
    authorize(x_runtime_token)
    rid = request_id("turn")

    async def body():
        async for item in engine.stream_turn(
            req.prompt,
            rid,
            preface=req.preface or "",
            voice_id=req.voiceId,
            avatar_id=req.avatarId,
            session_id=req.sessionId or "",
            tenant_id=req.tenantId or "",
            assistant_name=req.assistantName or "",
        ):
            yield ndjson(item)

    return StreamingResponse(body(), media_type="application/x-ndjson")


@app.get("/v1/avatar-renders/{job_id}")
async def avatar_render_status(
    job_id: str, x_runtime_token: str | None = Header(default=None)
):
    authorize(x_runtime_token)
    try:
        return await engine.avatar.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/avatar-renders/{job_id}/video")
async def avatar_render_video(
    job_id: str, x_runtime_token: str | None = Header(default=None)
):
    authorize(x_runtime_token)
    try:
        content, media_type = await engine.avatar.get_video(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=content, media_type=media_type)
