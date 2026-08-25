const assert = require("assert");
const liveVideo = require("../backend/functions/api/live-video");

assert.equal(liveVideo.liveKitHttpUrl("wss://eila.example.livekit.cloud"), "https://eila.example.livekit.cloud");
assert.equal(
  liveVideo.zoomMeetingUrl("https://us05web.zoom.us/j/12345678901?pwd=abc"),
  "https://us05web.zoom.us/j/12345678901?pwd=abc",
);
assert.throws(() => liveVideo.zoomMeetingUrl("https://example.com/j/123"), /Zoom/);
assert.throws(() => liveVideo.zoomMeetingUrl("https://zoom.us/w/123"), /participant/);

(async () => {
  const adminToken = await liveVideo.liveKitAdminToken(
    "test-key",
    "test-secret-with-more-than-thirty-two-bytes",
    "ebc-video-test-room",
  );
  const claims = JSON.parse(Buffer.from(adminToken.split(".")[1], "base64url").toString("utf8"));
  assert.equal(claims.iss, "test-key");
  assert.equal(claims.sub, undefined);
  assert.equal(claims.video.roomAdmin, true);
  assert.equal(claims.video.room, "ebc-video-test-room");

  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, init) => {
    request = { url:String(url), init };
    return { ok:true, json:async () => ({ id:"dispatch-1" }) };
  };

  try {
    const result = await liveVideo({
      method:"POST",
      body:{ meetingUrl:"https://us05web.zoom.us/j/12345678901?pwd=abc" },
      env:{
        LIVEKIT_URL:"wss://eila.example.livekit.cloud",
        LIVEKIT_API_KEY:"test-key",
        LIVEKIT_API_SECRET:"test-secret-with-more-than-thirty-two-bytes",
        LIVEKIT_MEETING_AGENT_NAME:"lemonslice",
        LIVE_VIDEO_BOT_NAME:"EILA",
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.dispatchId, "dispatch-1");
    assert.equal(request.url, "https://eila.example.livekit.cloud/twirp/livekit.AgentDispatchService/CreateDispatch");
    const dispatch = JSON.parse(request.init.body);
    assert.equal(dispatch.agent_name, "lemonslice");
    assert.equal(JSON.parse(dispatch.metadata).meeting_url, result.data.joinUrl);
    assert.match(request.init.headers.Authorization, /^Bearer /);
  } finally {
    global.fetch = originalFetch;
  }

  console.log("live-video tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
