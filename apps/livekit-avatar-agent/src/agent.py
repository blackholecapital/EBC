"""Everything Built Custom owned LiveKit and LemonSlice support avatar."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import pathlib
from urllib.parse import quote

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions, inference, room_io
from livekit.plugins import lemonslice, noise_cancellation, openai

APP_ROOT = pathlib.Path(__file__).resolve().parents[1]
load_dotenv(APP_ROOT / ".env.local")
load_dotenv(APP_ROOT / ".env")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("ebc.avatar")
TENANT_ID = "ebc"
AGENT_NAME = os.getenv("AGENT_NAME", "ebc-avatar").strip() or "ebc-avatar"
AGENT_HTTP_PORT = int(os.getenv("AGENT_HTTP_PORT", "8093"))
RELAY_BASE_URL = os.getenv(
    "EBC_VIDEO_RELAY_URL",
    "https://ebc-video-worker.cryptocapitalgroupfl.workers.dev/internal/lemonslice/sessions",
).strip()

VOICE_RULES = """
Voice delivery rules:
- Answer immediately in one or two short sentences.
- Ask only one question at a time.
- Never narrate reasoning or infrastructure details.
- Give the operator the shortest useful dashboard step.
""".strip()


class Assistant(Agent):
    def __init__(self, instructions: str) -> None:
        super().__init__(instructions=f"{instructions.rstrip()}\n\n{VOICE_RULES}")


def required(data: dict, key: str) -> str:
    value = str(data.get(key) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required dispatch metadata: {key}")
    return value


def metadata_for(ctx: agents.JobContext) -> dict:
    if not ctx.job.metadata:
        raise RuntimeError("Dispatch metadata is required")
    try:
        data = json.loads(ctx.job.metadata)
    except Exception as exc:
        raise RuntimeError("Invalid dispatch metadata JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError("Dispatch metadata must be an object")
    if required(data, "tenant_id") != TENANT_ID:
        raise RuntimeError("EBC avatar only accepts tenant_id=ebc")
    return data


def avatar_options(metadata: dict) -> dict:
    source = required(metadata, "avatar_source").lower()
    if required(metadata, "avatar_provider").lower() != "lemonslice":
        raise RuntimeError("EBC avatar_provider must be lemonslice")
    if source == "image-url":
        return {"agent_image_url": required(metadata, "avatar_image_url")}
    if source == "agent-id":
        return {"agent_id": required(metadata, "lemonslice_agent_id")}
    raise RuntimeError(f"Unsupported EBC avatar_source: {source}")


def build_tts(metadata: dict):
    if required(metadata, "voice_provider").lower() != "livekit-inference":
        raise RuntimeError("EBC voice_provider must be livekit-inference")
    model = required(metadata, "voice_model")
    voice = required(metadata, "voice_id").lower()
    logger.info("TTS_SOURCE tenant=ebc provider=livekit-inference model=%s voice=%s", model, voice)
    return inference.TTS(model=model, voice=voice, language="en")


def text_input_handler(session: AgentSession, event: room_io.TextInputEvent) -> None:
    message = str(event.text or "").strip()
    if not message:
        return
    logger.info("TEXT_INPUT source=lk.chat characters=%s", len(message))
    session.interrupt()
    session.generate_reply(user_input=message)


server = AgentServer(port=AGENT_HTTP_PORT)


@server.rtc_session(agent_name=AGENT_NAME)
async def ebc_avatar_agent(ctx: agents.JobContext) -> None:
    metadata = metadata_for(ctx)
    instructions = required(metadata, "instructions")
    relay_room = required(metadata, "relay_room")
    relay_token = required(metadata, "relay_token")

    session = AgentSession(
        llm=openai.LLM.with_ollama(
            model=os.getenv("LOCAL_LLM_MODEL", "qwen3.5:9b"),
            base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434/v1"),
            temperature=float(os.getenv("LOCAL_LLM_TEMPERATURE", "0.35")),
            reasoning_effort=os.getenv("LOCAL_LLM_REASONING_EFFORT", "none"),
        ),
        stt=inference.STT(
            model=os.getenv("LIVEKIT_STT_MODEL", "deepgram/nova-3"),
            language="en",
        ),
        tts=build_tts(metadata),
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
            endpointing={"mode": "dynamic", "min_delay": 0.25, "max_delay": 1.2, "alpha": 0.65},
            interruption={"mode": "adaptive", "min_duration": 0.7, "min_words": 1, "resume_false_interruption": False},
            preemptive_generation={"preemptive_tts": True},
        ),
    )

    await ctx.connect(single_peer_connection=True)
    separator = "&" if "?" in RELAY_BASE_URL else "?"
    relay_url = f"{RELAY_BASE_URL}{separator}tenant={quote(TENANT_ID)}&room={quote(relay_room)}"
    avatar = lemonslice.AvatarSession(
        **avatar_options(metadata),
        agent_prompt=str(metadata.get("avatar_prompt") or "an attentive EBC support consultant speaking").strip(),
        agent_idle_prompt=str(metadata.get("avatar_idle_prompt") or "an attentive EBC support consultant listening").strip(),
        api_url=relay_url,
        api_key=relay_token,
    )

    logger.info("EBC_AVATAR_START room=%s", relay_room)
    await avatar.start(session, room=ctx.room)
    await session.start(
        room=ctx.room,
        agent=Assistant(instructions=instructions),
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(noise_cancellation=noise_cancellation.BVC()),
            audio_output=False,
            text_input=room_io.TextInputOptions(text_input_cb=text_input_handler),
            text_output=True,
        ),
    )
    await avatar.wait_for_join()
    await asyncio.sleep(0.25)
    await session.say("Hi, I'm EILA Support. How can I help with the EBC dashboard?", allow_interruptions=False)


if __name__ == "__main__":
    agents.cli.run_app(server)
