import asyncio
import unittest

import numpy as np

from eila_runtime.config import Settings
from eila_runtime.engine import VoiceEngine
from eila_runtime.tts import Speech


class FakeAvatarJob:
    job_id = "a" * 32
    status = "queued"


class FakeAvatar:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    async def render(self, samples, sample_rate, **metadata):
        self.calls.append((samples, sample_rate, metadata))
        if self.error:
            raise self.error
        return FakeAvatarJob()


class FakeLlm:
    async def stream(self, _prompt):
        for token in ["I can help ", "with that today. ", "What capacity do you need?"]:
            yield token


class FakeTts:
    def __init__(self):
        self.voice_ids = []

    async def synthesize(self, text, voice_id=None):
        self.voice_ids.append(voice_id)
        duration = max(0.1, len(text) / 100)
        return Speech(np.zeros(int(24000 * duration), dtype=np.float32), 24000)


class BlockingSecondPhraseTts(FakeTts):
    def __init__(self):
        super().__init__()
        self.second_phrase_started = asyncio.Event()
        self.release_second_phrase = asyncio.Event()

    async def synthesize(self, text, voice_id=None):
        if self.voice_ids:
            self.second_phrase_started.set()
            await self.release_second_phrase.wait()
        return await super().synthesize(text, voice_id)


class EngineTests(unittest.IsolatedAsyncioTestCase):
    async def test_livekit_stream_emits_before_all_phrases_finish(self):
        settings = Settings(
            runtime_token="test",
            phrase_min_words=2,
            phrase_target_words=4,
            phrase_max_words=8,
            phrase_first_max_words=4,
            audio_chunk_ms=100,
        )
        engine = VoiceEngine(settings)
        engine.tts = BlockingSecondPhraseTts()
        stream = engine.stream_livekit_speech(
            "I can help with that today. What capacity do you need?",
            "livekit_test",
        )

        first_chunk = await anext(stream)

        self.assertEqual(len(first_chunk), 4800)
        self.assertFalse(engine.tts.second_phrase_started.is_set())
        await stream.aclose()

    async def test_livekit_stream_is_continuous_pcm16(self):
        settings = Settings(
            runtime_token="test",
            phrase_min_words=2,
            phrase_target_words=4,
            phrase_max_words=8,
            phrase_first_max_words=4,
            audio_chunk_ms=100,
        )
        engine = VoiceEngine(settings)
        engine.tts = FakeTts()

        chunks = [
            chunk
            async for chunk in engine.stream_livekit_speech(
                "I can help with that today. What capacity do you need?",
                "livekit_pcm_test",
            )
        ]

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 4800 for chunk in chunks))
        self.assertTrue(all(len(chunk) % 2 == 0 for chunk in chunks))
        pcm = np.frombuffer(b"".join(chunks), dtype="<i2")
        self.assertGreater(pcm.size, 0)

    async def test_turn_stream_contains_text_audio_and_metrics(self):
        settings = Settings(
            runtime_token="test",
            phrase_min_words=3,
            phrase_target_words=6,
            phrase_max_words=10,
        )
        engine = VoiceEngine(settings)
        engine.llm = FakeLlm()
        engine.tts = FakeTts()

        events = [item async for item in engine.stream_turn("prompt", "turn_test")]
        event_types = [item["type"] for item in events]
        self.assertIn("text.delta", event_types)
        self.assertIn("text.phrase", event_types)
        self.assertIn("audio.chunk", event_types)
        self.assertEqual(event_types[-1], "response.completed")
        self.assertEqual(events[-1]["text"], "I can help with that today. What capacity do you need?")
        self.assertEqual(events[-1]["voiceId"], "eila")
        self.assertTrue(all(voice_id == "eila" for voice_id in engine.tts.voice_ids))
        self.assertGreater(events[-1]["audioBytes"], 0)
        self.assertIsNotNone(events[-1]["firstAudioMs"])

    async def test_cached_preface_audio_precedes_generated_reply(self):
        settings = Settings(
            runtime_token="test",
            phrase_min_words=3,
            phrase_target_words=6,
            phrase_max_words=10,
        )
        engine = VoiceEngine(settings)
        engine.llm = FakeLlm()
        engine.tts = FakeTts()

        events = [
            item
            async for item in engine.stream_turn(
                "prompt", "turn_preface", preface="Got it."
            )
        ]
        event_types = [item["type"] for item in events]
        self.assertEqual(event_types[0:2], ["response.started", "text.preface"])
        self.assertLess(event_types.index("audio.chunk"), event_types.index("text.delta"))
        self.assertEqual(events[-1]["text"], "I can help with that today. What capacity do you need?")

    async def test_ebc_alias_routes_to_eila_voice(self):
        settings = Settings(runtime_token="test", tts_default_voice="eila", tts_voice_aliases="ace:eila")
        engine = VoiceEngine(settings)
        engine.llm = FakeLlm()
        engine.tts = FakeTts()

        events = [
            item
            async for item in engine.stream_turn(
                "prompt", "turn_ace", voice_id="ace"
            )
        ]
        self.assertEqual(events[-1]["voiceId"], "eila")
        self.assertTrue(all(voice_id == "eila" for voice_id in engine.tts.voice_ids))

    async def test_avatar_turn_queues_clean_audio_without_changing_voice_stream(self):
        settings = Settings(
            runtime_token="test",
            phrase_min_words=3,
            phrase_target_words=6,
            phrase_max_words=10,
        )
        engine = VoiceEngine(settings)
        engine.llm = FakeLlm()
        engine.tts = FakeTts()
        engine.avatar = FakeAvatar()

        events = [
            item
            async for item in engine.stream_turn(
                "prompt",
                "turn_avatar",
                voice_id="eila",
                avatar_id="eila",
                session_id="session-1",
                tenant_id="eila-assistant",
                assistant_name="Eila",
            )
        ]
        event_types = [item["type"] for item in events]
        self.assertIn("audio.chunk", event_types)
        self.assertEqual(event_types[-2:], ["avatar.queued", "response.completed"])
        self.assertEqual(events[-1]["avatarJobId"], "a" * 32)
        self.assertEqual(len(engine.avatar.calls), 1)
        samples, sample_rate, metadata = engine.avatar.calls[0]
        self.assertEqual(sample_rate, 24000)
        self.assertGreater(samples.size, 0)
        self.assertEqual(metadata["tenant_id"], "eila-assistant")

    async def test_avatar_failure_is_nonfatal(self):
        settings = Settings(
            runtime_token="test",
            phrase_min_words=3,
            phrase_target_words=6,
            phrase_max_words=10,
        )
        engine = VoiceEngine(settings)
        engine.llm = FakeLlm()
        engine.tts = FakeTts()
        engine.avatar = FakeAvatar(RuntimeError("avatar offline"))

        events = [
            item
            async for item in engine.stream_turn(
                "prompt", "turn_avatar_error", avatar_id="eila"
            )
        ]
        self.assertEqual(events[-2]["type"], "avatar.error")
        self.assertEqual(events[-1]["type"], "response.completed")
        self.assertEqual(events[-1]["avatarError"], "avatar offline")

    async def test_voice_only_turn_does_not_call_avatar(self):
        settings = Settings(runtime_token="test")
        engine = VoiceEngine(settings)
        engine.llm = FakeLlm()
        engine.tts = FakeTts()
        engine.avatar = FakeAvatar()

        events = [item async for item in engine.stream_turn("prompt", "turn_voice_only")]
        self.assertEqual(events[-1]["type"], "response.completed")
        self.assertEqual(engine.avatar.calls, [])


if __name__ == "__main__":
    unittest.main()
