from __future__ import annotations

import json
import time
import uuid
from typing import Any


def request_id(prefix: str = "eila") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def event(event_type: str, request_id_value: str, **payload: Any) -> dict[str, Any]:
    return {
        "type": event_type,
        "requestId": request_id_value,
        "timestampMs": int(time.time() * 1000),
        **payload,
    }


def ndjson(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
