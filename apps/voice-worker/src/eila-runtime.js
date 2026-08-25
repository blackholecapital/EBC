function enabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

function base64ByteLength(value = "") {
  const input = String(value || "");
  if (!input) return 0;
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((input.length * 3) / 4) - padding);
}

function positiveMilliseconds(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runtimeSettings(env) {
  return {
    enabled: enabled(env.EILA_RUNTIME_STREAMING),
    baseUrl: String(env.EILA_RUNTIME_URL || env.BUDDY_RUNTIME_URL || "")
      .trim()
      .replace(/\/$/, ""),
    token: String(env.EILA_RUNTIME_TOKEN || env.BUDDY_RUNTIME_TOKEN || "").trim(),
    voiceId: String(env.EILA_VOICE_ID || "").trim().toLowerCase(),
    firstAudioTimeoutMs: positiveMilliseconds(env.EILA_FIRST_AUDIO_TIMEOUT_MS, 8000),
    totalTimeoutMs: positiveMilliseconds(env.EILA_TOTAL_TIMEOUT_MS, 30000),
  };
}

export function eilaRuntimeEnabled(env) {
  const settings = runtimeSettings(env);
  return settings.enabled && Boolean(settings.baseUrl && settings.token);
}

async function streamEvents(env, path, payload, handlers = {}) {
  const settings = runtimeSettings(env);
  if (!settings.enabled) throw new Error("EILA runtime streaming is disabled");
  if (!settings.baseUrl) throw new Error("EILA_RUNTIME_URL is not configured");
  if (!settings.token) throw new Error("EILA_RUNTIME_TOKEN is not configured");

  const startedAt = Date.now();
  const controller = new AbortController();
  let timeoutStage = "first audio";
  const firstAudioTimer = setTimeout(
    () => controller.abort(),
    settings.firstAudioTimeoutMs,
  );
  const totalTimer = setTimeout(() => {
    timeoutStage = "completion";
    controller.abort();
  }, settings.totalTimeoutMs);

  let response;
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
        "x-runtime-token": settings.token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(firstAudioTimer);
    clearTimeout(totalTimer);
    if (controller.signal.aborted) {
      throw new Error(
        `EILA runtime ${path} timed out waiting for ${timeoutStage}`,
      );
    }
    throw error;
  }
  if (!response.ok || !response.body) {
    clearTimeout(firstAudioTimer);
    clearTimeout(totalTimer);
    const detail = await response.text().catch(() => "");
    throw new Error(`EILA runtime ${path} failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let audioBytes = 0;
  let audioChunks = 0;
  let firstAudioMs = null;
  let completed = null;

  const dispatch = async (item) => {
    if (item.type === "text.delta") text += String(item.delta || "");
    if (item.type === "text.completed") {
      if (item.text) text = String(item.text);
      await handlers.onTextCompleted?.(text.trim(), item);
    }
    if (item.type === "audio.chunk") {
      const audio = String(item.audio || "");
      if (audio) {
        if (firstAudioMs === null) {
          firstAudioMs = Date.now() - startedAt;
          clearTimeout(firstAudioTimer);
        }
        audioBytes += base64ByteLength(audio);
        audioChunks += 1;
        const keepGoing = await handlers.onAudio?.(audio, item);
        if (keepGoing === false) return false;
      }
    }
    if (item.type === "response.completed" || item.type === "audio.completed") {
      completed = item;
      if (item.text) text = String(item.text);
    }
    if (item.type === "response.error") {
      const error = new Error(`EILA runtime ${item.stage || "stream"} failed: ${item.error || "unknown error"}`);
      error.partialAudio = audioBytes > 0;
      throw error;
    }
    await handlers.onEvent?.(item);
    return true;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if ((await dispatch(JSON.parse(line))) === false) {
          await reader.cancel("call-turn-cancelled").catch(() => {});
          return { cancelled: true, text, audioBytes, audioChunks, firstAudioMs };
        }
      }
      if (done) break;
    }
    if (buffer.trim()) await dispatch(JSON.parse(buffer));
  } catch (error) {
    if (controller.signal.aborted && !audioBytes) {
      error = new Error(
        `EILA runtime ${path} timed out waiting for ${timeoutStage}`,
      );
    }
    if (error.partialAudio === undefined) error.partialAudio = audioBytes > 0;
    if (error.partialText === undefined) error.partialText = text.trim();
    throw error;
  } finally {
    clearTimeout(firstAudioTimer);
    clearTimeout(totalTimer);
  }

  return {
    cancelled: false,
    text: text.trim(),
    audioBytes,
    audioChunks,
    firstAudioMs: completed?.firstAudioMs ?? firstAudioMs,
    totalLatencyMs: completed?.totalLatencyMs ?? Date.now() - startedAt,
  };
}

export function streamEilaSpeech(env, text, handlers) {
  const settings = runtimeSettings(env);
  const payload = { text };
  if (settings.voiceId) payload.voiceId = settings.voiceId;
  return streamEvents(env, "/v1/speech", payload, handlers);
}

export function streamEilaTurn(env, payload, handlers) {
  const settings = runtimeSettings(env);
  const body = { ...(payload || {}) };
  if (!body.voiceId && settings.voiceId) body.voiceId = settings.voiceId;
  return streamEvents(env, "/v1/turn", body, handlers);
}
