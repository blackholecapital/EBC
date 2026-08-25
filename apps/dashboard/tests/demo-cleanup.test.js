const assert = require("node:assert/strict");
const test = require("node:test");

const db = require("../backend/layers/core/db");
const memoryStore = require("../backend/layers/core/memory-store");
memoryStore.reset();
db.setBackend(memoryStore);

const contacts = require("../backend/layers/domain/contacts");
const inboxHandler = require("../backend/functions/api/inbox");
const callNow = require("../backend/functions/api/call-now");

test("call-now renders a branded human page without exposing call JSON", () => {
  const html = callNow.callPage({
    ok:true,
    title:"EBC AI is calling you now",
    message:"Keep your phone nearby.",
  });
  assert.match(html, /EBC AI is calling you now/);
  assert.match(html, /EBC<\/b> HOST/);
  assert.doesNotMatch(html, /contactId|callSid|provider/);
});

test("dashboard SMS uses the concierge/Twilio path and reports provider acceptance", async () => {
  const contact = contacts.create({
    firstName:"Casey",
    lastName:"Customer",
    phone:"+18135550199",
    smsConsent:true,
  });
  let outbound = null;
  const env = {
    INTERNAL_CALL_SECRET:"test-secret",
    CONCIERGE:{
      async fetch(request) {
        outbound = { url:request.url, body:await request.json() };
        return Response.json({ ok:true, sms:{ ok:true, provider:"twilio", messageSid:"SM_TEST" } });
      },
    },
  };

  const result = await inboxHandler({
    method:"POST",
    body:{ contactId:contact.id, channel:"sms", body:"Hello from Everything Built Custom" },
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(outbound.url, "https://concierge.internal/internal/messages");
  assert.equal(outbound.body.contactId, contact.id);
  assert.equal(outbound.body.message, "Hello from Everything Built Custom");
  assert.equal(result.data.sms.messageSid, "SM_TEST");
});

test("dashboard SMS does not claim success when Twilio rejects it", async () => {
  const contact = contacts.list()[0];
  const result = await inboxHandler({
    method:"POST",
    body:{ contactId:contact.id, channel:"sms", body:"This should fail" },
    env:{
      INTERNAL_CALL_SECRET:"test-secret",
      CONCIERGE:{ async fetch() { return Response.json({ ok:false, error:"Twilio rejected the message" }, { status:502 }); } },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Twilio rejected/);
});
