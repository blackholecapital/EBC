import assert from "node:assert/strict";
import test from "node:test";

import { inboundSmsTarget, isEbcCallbackReply, twilioFormSignature, validateTwilioFormRequest } from "../src/inbound.js";
import worker from "../src/index.js";

const env = {
  EBC_SMS_WEBHOOK_URL:"https://ebc.example/twilio/sms",
};

test("the dedicated EBC number routes every reply to EBC", () => {
  assert.equal(isEbcCallbackReply("EBC"), true);
  assert.equal(isEbcCallbackReply("EBC call me"), true);
  assert.equal(isEbcCallbackReply("CALL"), false);
  assert.deepEqual(inboundSmsTarget(env, { Body:"EBC" }), {
    pipeline:"ebc",
    reply:"EBC",
    url:env.EBC_SMS_WEBHOOK_URL,
  });
  assert.equal(inboundSmsTarget(env, { Body:"CALL" }).url, env.EBC_SMS_WEBHOOK_URL);
});

test("Twilio form signatures validate against the exact inbound URL", async () => {
  const url = "https://ebc-sms.example/twilio/sms";
  const body = { Body:"EBC", From:"+16179016112", MessageSid:"SM123", To:"+18137366088" };
  const authToken = "test-auth-token";
  const signature = await twilioFormSignature(url, body, authToken);
  const request = new Request(url, { headers:{ "x-twilio-signature":signature } });
  assert.equal(await validateTwilioFormRequest(request, body, authToken), true);
  assert.equal(await validateTwilioFormRequest(new Request(`${url}?bad=1`, { headers:{ "x-twilio-signature":signature } }), body, authToken), false);
});

test("the public Twilio route re-signs EBC replies for the EBC voice worker", async () => {
  const inboundUrl = "https://ebc-sms-worker.example/twilio/sms";
  const body = { Body:"EBC", From:"+16179016112", MessageSid:"SM456", To:"+18137366088" };
  const authToken = "test-auth-token";
  const envWithToken = { ...env, TWILIO_AUTH_TOKEN:authToken, PUBLIC_BASE_URL:"https://ebc-sms-worker.example" };
  const signature = await twilioFormSignature(inboundUrl, body, authToken);
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url:String(url), init };
    return new Response("<Response></Response>", { status:200, headers:{ "content-type":"text/xml" } });
  };

  try {
    const response = await worker.fetch(new Request(inboundUrl, {
      method:"POST",
      headers:{
        "content-type":"application/x-www-form-urlencoded",
        "x-twilio-signature":signature,
      },
      body:new URLSearchParams(body).toString(),
    }), envWithToken);
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, env.EBC_SMS_WEBHOOK_URL);
    const forwardedBody = Object.fromEntries(new URLSearchParams(forwarded.init.body));
    const forwardedRequest = new Request(forwarded.url, {
      headers:{ "x-twilio-signature":forwarded.init.headers["x-twilio-signature"] },
    });
    assert.equal(await validateTwilioFormRequest(forwardedRequest, forwardedBody, authToken), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
