# LiveKit EILA TTS adapter

This adapter sends LiveKit Agent text to the shared EILA Chatterbox runtime and
returns 24 kHz mono PCM16. LemonSlice receives the same PCM stream it uses to
generate and publish synchronized avatar audio and video.

Environment:

- `EILA_RUNTIME_URL` — use `http://127.0.0.1:8000` when colocated.
- `EILA_RUNTIME_TOKEN` — the existing private runtime token.
- Voice ID defaults to `eila`.

Use in the LiveKit agent:

```python
from livekit_tts import EilaRuntimeTTS

session = AgentSession(
    llm=...,
    stt=...,
    tts=EilaRuntimeTTS(voice_id="eila"),
)
```

Wait for the LemonSlice video track before the opening reply:

```python
await avatar.wait_for_join()
await session.generate_reply()
```
