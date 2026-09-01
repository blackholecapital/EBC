import assert from "node:assert/strict";
import test from "node:test";

import worker, { apiHeaderValue, normalizeSession } from "../src/index.js";

test("registers the dedicated EBC tenant contract", () => {
  const input = normalizeSession({
    tenantId:"ebc",
    creatorId:"eila",
    avatarProvider:"lemonslice",
    avatarSource:"image-url",
    avatarImageUrl:"https://example.com/eila.jpg",
    voiceProvider:"livekit-inference",
    voiceModel:"xai/tts-1",
    voiceId:"carina",
    instructions:"Help the EBC operator.",
  });
  assert.equal(input.tenantId, "ebc");
  assert.equal(input.creatorId, "eila");
  assert.equal(input.voiceId, "carina");
});

test("rejects every other tenant", () => {
  assert.throws(() => normalizeSession({ tenantId:"buddys" }), /tenantId must be ebc/);
});

test("normalizes pasted provider keys", () => {
  assert.equal(apiHeaderValue("  sk-test\n"), "sk-test");
});

test("health exposes the EBC-owned service and agent", async () => {
  const response = await worker.fetch(new Request("https://video.test/health"), {
    LIVEKIT_URL:"wss://example.livekit.cloud",
    LIVEKIT_API_KEY:"key",
    LIVEKIT_API_SECRET:"secret",
    LEMONSLICE_EBC_API_KEY:"sk-test",
    VIDEO_AGENT_NAME:"ebc-avatar",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.service, "ebc-video-worker");
  assert.equal(body.tenant, "ebc");
  assert.equal(body.agentName, "ebc-avatar");
  assert.equal(body.lemonsliceConfigured, true);
});
