import io
import unittest
import wave

import numpy as np

from eila_runtime.avatar import AvatarRuntime, wav_payload
from eila_runtime.config import Settings


class AvatarTests(unittest.TestCase):
    def test_wav_payload_is_mono_pcm16_at_source_rate(self):
        payload = wav_payload(np.zeros(2400, dtype=np.float32), 24000)
        with wave.open(io.BytesIO(payload), "rb") as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getsampwidth(), 2)
            self.assertEqual(wav.getframerate(), 24000)
            self.assertEqual(wav.getnframes(), 2400)

    def test_job_id_validation_rejects_untrusted_paths(self):
        runtime = AvatarRuntime(Settings(runtime_token="test"))
        self.assertEqual(runtime.validate_job_id("A" * 32), "a" * 32)
        with self.assertRaises(ValueError):
            runtime.validate_job_id("../video")


if __name__ == "__main__":
    unittest.main()
