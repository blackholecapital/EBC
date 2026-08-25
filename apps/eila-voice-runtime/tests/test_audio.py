import unittest

import numpy as np

from eila_runtime.audio import chunks, mulaw_encode, twilio_mulaw


class AudioTests(unittest.TestCase):
    def test_mulaw_silence_is_standard_ff(self):
        encoded = mulaw_encode(np.zeros(160, dtype=np.int16))
        self.assertEqual(encoded, bytes([0xFF]) * 160)

    def test_twilio_audio_is_eight_kilohertz(self):
        source = np.zeros(2400, dtype=np.float32)
        encoded = twilio_mulaw(source, 24000)
        self.assertEqual(len(encoded), 800)

    def test_chunks_preserve_payload(self):
        payload = bytes(range(256)) * 10
        self.assertEqual(b"".join(chunks(payload, chunk_ms=20)), payload)


if __name__ == "__main__":
    unittest.main()
