from __future__ import annotations

import json
from collections.abc import AsyncIterator

from .config import Settings


class StreamingLlm:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def stream(self, prompt: str) -> AsyncIterator[str]:
        if self.settings.llm_provider == "ollama":
            async for token in self._ollama(prompt):
                yield token
            return
        async for token in self._openai_compatible(prompt):
            yield token

    async def complete(self, prompt: str) -> str:
        parts = [token async for token in self.stream(prompt)]
        return "".join(parts).strip()

    async def _ollama(self, prompt: str) -> AsyncIterator[str]:
        import httpx

        url = f"{self.settings.llm_base_url.rstrip('/')}/api/generate"
        timeout = httpx.Timeout(self.settings.llm_timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                url,
                json={
                    "model": self.settings.llm_model,
                    "prompt": prompt,
                    "stream": True,
                    "think": self.settings.llm_think,
                    "keep_alive": self.settings.llm_keep_alive,
                    "options": {
                        "temperature": self.settings.llm_temperature,
                        "num_predict": self.settings.llm_num_predict,
                        "num_ctx": self.settings.llm_num_ctx,
                    },
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    token = str(data.get("response") or "")
                    if token:
                        yield token
                    if data.get("done"):
                        break

    async def _openai_compatible(self, prompt: str) -> AsyncIterator[str]:
        import httpx

        url = f"{self.settings.llm_base_url.rstrip('/')}/v1/chat/completions"
        headers = {"content-type": "application/json"}
        if self.settings.llm_api_key:
            headers["authorization"] = f"Bearer {self.settings.llm_api_key}"
        timeout = httpx.Timeout(self.settings.llm_timeout_seconds)
        payload = {
            "model": self.settings.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
            "temperature": 0.45,
        }
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    data = json.loads(raw)
                    token = data.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                    if token:
                        yield str(token)
