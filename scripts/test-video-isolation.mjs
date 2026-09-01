import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const concierge = readFileSync(new URL("../apps/blackhole-concierge-worker/wrangler.toml", import.meta.url), "utf8");
const video = readFileSync(new URL("../apps/video-worker/wrangler.toml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../apps/video-worker/src/index.js", import.meta.url), "utf8");
const agent = readFileSync(new URL("../apps/livekit-avatar-agent/src/agent.py", import.meta.url), "utf8");
const conciergeSource = readFileSync(new URL("../apps/blackhole-concierge-worker/src/index.js", import.meta.url), "utf8");
const boundary = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

assert.match(concierge, /TENANT_ID = "ebc"/);
assert.match(concierge, /binding = "VIDEO"\s+service = "ebc-video-worker"/);
assert.doesNotMatch(concierge, /service = "(?:blackhole|ace)-/);
assert.match(video, /name = "ebc-video-worker"/);
assert.match(video, /VIDEO_AGENT_NAME = "ebc-avatar"/);
assert.match(video, /binding = "EBC_VIDEO_CAPABILITY_TOKEN"[\s\S]*?secret_name = "XYZ_DEMO_RUNTIME_TOKEN"/);
assert.match(video, /binding = "LEMONSLICE_EBC_API_KEY"[\s\S]*?secret_name = "XYZ_DEMO_LEMONSLICE_API_KEY"/);
assert.match(worker, /const TENANT_ID = "ebc"/);
assert.match(worker, /tenantId must be ebc/);
assert.match(conciergeSource, /"x-ebc-video-capability-token":capabilityToken/);
assert.doesNotMatch(conciergeSource, /blackhole-video-worker|https:\/\/blackhole\.internal/);
assert.match(agent, /TENANT_ID = "ebc"/);
assert.match(agent, /AGENT_NAME = os\.getenv\("AGENT_NAME", "ebc-avatar"\)/);
assert.match(boundary, /Never edit, commit to, open a pull request against, or require a code change in `blackholecapital\/cloudflare-platform`/);

console.log("EBC video ownership and repository-isolation contract: OK");
