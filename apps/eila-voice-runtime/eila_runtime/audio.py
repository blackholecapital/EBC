from __future__ import annotations

import math

import numpy as np
from scipy.signal import resample_poly


def normalize_waveform(samples: np.ndarray) -> np.ndarray:
    audio = np.asarray(samples, dtype=np.float32).squeeze()
    if audio.ndim != 1:
        raise ValueError("TTS waveform must be mono")
    return np.clip(audio, -1.0, 1.0)


def resample(samples: np.ndarray, source_rate: int, target_rate: int = 8000) -> np.ndarray:
    audio = normalize_waveform(samples)
    if source_rate == target_rate:
        return audio
    divisor = math.gcd(source_rate, target_rate)
    return resample_poly(audio, target_rate // divisor, source_rate // divisor).astype(np.float32)


def pcm16(samples: np.ndarray) -> np.ndarray:
    return (normalize_waveform(samples) * 32767.0).astype(np.int16)


def mulaw_encode(samples: np.ndarray) -> bytes:
    """Encode signed 16-bit PCM as ITU-T G.711 mu-law."""
    signed = np.asarray(samples, dtype=np.int16).astype(np.int32)
    sign = np.where(signed < 0, 0x80, 0)
    magnitude = np.minimum(np.abs(signed), 32635) + 0x84
    exponent = np.floor(np.log2(magnitude)).astype(np.int32) - 7
    exponent = np.clip(exponent, 0, 7)
    mantissa = (magnitude >> (exponent + 3)) & 0x0F
    encoded = (~(sign | (exponent << 4) | mantissa)) & 0xFF
    return encoded.astype(np.uint8).tobytes()


def twilio_mulaw(samples: np.ndarray, source_rate: int) -> bytes:
    return mulaw_encode(pcm16(resample(samples, source_rate, 8000)))


def chunks(payload: bytes, chunk_ms: int = 100, sample_rate: int = 8000):
    chunk_size = max(1, int(sample_rate * chunk_ms / 1000))
    for offset in range(0, len(payload), chunk_size):
        yield payload[offset : offset + chunk_size]
