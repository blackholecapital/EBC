const assert = require("assert");
const db = require("../backend/layers/core/db");
const memoryStore = require("../backend/layers/core/memory-store");
const { routeRequest } = require("../backend/edge-router");
const permissions = require("../shared/permissions");
const videoSession = require("../backend/functions/api/video-session");

db.setBackend(memoryStore);
memoryStore.reset();

assert.equal(permissions.resolvePermission("POST", "/api/video/session"), "dashboard:read");
assert.equal(permissions.resolvePermission("POST", "/api/video/transcript"), "dashboard:read");
assert.equal(routeRequest("/api/video/session", "POST").fn, videoSession);

(async () => {
  let forwardedRequest;
  const env = {
    INTERNAL_CALL_SECRET:"test-internal-secret",
    CONCIERGE:{
      async fetch(request) {
        forwardedRequest = request;
        return Response.json({
          ok:true,
          livekitUrl:"wss://example.livekit.cloud",
          token:"participant-token",
          room:"bh-ebc-eila-test",
          dispatchId:"dispatch-ebc-test",
          tenantId:"ebc",
        });
      },
    },
  };

  const direct = await videoSession({
    method:"POST",
    body:{ firstName:"Demo", company:"Everything Built Custom", interest:"Custom Roofs" },
    env,
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.tenantId, "ebc");
  assert.equal(direct.livekitUrl, "wss://example.livekit.cloud");
  assert.equal(forwardedRequest.headers.get("x-internal-call-secret"), "test-internal-secret");
  assert.equal(new URL(forwardedRequest.url).pathname, "/internal/video/session");
  const payload = JSON.parse(await forwardedRequest.text());
  assert.equal(payload.source, "ebc-dashboard-support");
  assert.equal(payload.context.interest, "Custom Roofs");

  console.log("support-video tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
