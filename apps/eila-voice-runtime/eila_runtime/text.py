from __future__ import annotations

import re


class PhraseChunker:
    """Turns streaming LLM tokens into short, speakable phrases."""

    _strong_boundary = re.compile(r"[.!?](?:[\"')\]]+)?\s*$")
    _soft_boundary = re.compile(r"[,;:—-]\s*$")
    _embedded_soft_boundary = re.compile(r"[,;:—-](?:[\"')\]]+)?\s+")

    def __init__(
        self,
        minimum_words: int = 5,
        target_words: int = 12,
        maximum_words: int = 22,
        first_maximum_words: int | None = None,
    ):
        if not 1 <= minimum_words <= target_words <= maximum_words:
            raise ValueError("phrase word limits must satisfy 1 <= minimum <= target <= maximum")
        self.minimum_words = minimum_words
        self.target_words = target_words
        self.maximum_words = maximum_words
        self.first_maximum_words = first_maximum_words or maximum_words
        if not minimum_words <= self.first_maximum_words <= maximum_words:
            raise ValueError("first phrase maximum must be between minimum and maximum")
        self._buffer = ""
        self._phrase_count = 0

    def _emit(self, phrase: str, remainder: str = "") -> list[str]:
        self._buffer = remainder
        self._phrase_count += 1
        return [phrase]

    def push(self, token: str) -> list[str]:
        self._buffer += token
        clean = self._buffer.strip()
        words = clean.split()
        if not clean or len(words) < self.minimum_words:
            return []

        if len(words) >= self.target_words:
            for match in reversed(list(self._embedded_soft_boundary.finditer(self._buffer))):
                phrase = self._buffer[: match.end()].strip()
                if len(phrase.split()) < self.minimum_words:
                    continue
                return self._emit(phrase, self._buffer[match.end() :])

        maximum_words = (
            self.first_maximum_words if self._phrase_count == 0 else self.maximum_words
        )

        if bool(self._strong_boundary.search(clean)) or (
            len(words) >= self.target_words and bool(self._soft_boundary.search(clean))
        ):
            return self._emit(clean)

        # Wait for one additional word before enforcing the hard limit. Streaming
        # models commonly deliver terminal punctuation as the next token; emitting
        # at exactly the limit would strand that punctuation in its own audio chunk.
        if len(words) > maximum_words:
            word_matches = list(re.finditer(r"\S+", self._buffer))
            split_at = word_matches[maximum_words - 1].end()
            phrase = self._buffer[:split_at].strip()
            remainder = self._buffer[split_at:]
            return self._emit(phrase, remainder)

        return []

    def flush(self) -> list[str]:
        clean = self._buffer.strip()
        self._buffer = ""
        if clean and re.search(r"\w", clean):
            self._phrase_count += 1
            return [clean]
        return []

    def split_completed(self, text: str) -> list[str]:
        """Split completed text using the same rules as streaming LLM output.

        Feeding one lexical token at a time is intentional: ``push`` may emit at
        most one phrase per call, while a completed reply can contain many phrase
        boundaries in a single string.
        """
        phrases: list[str] = []
        for token in re.findall(r"\S+(?:\s+|$)", str(text)):
            phrases.extend(self.push(token))
        phrases.extend(self.flush())
        return phrases
