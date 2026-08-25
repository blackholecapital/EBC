const inbox = require("../../../layers/domain/inbox");
const compliance = require("../../../layers/domain/compliance");
const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

module.exports = async function handler({ method, body, env }) {
  if (method === "GET") return { ok: true, data: inbox.list() };
  if (method === "POST" && body.mode === "reply") {
    if (compliance.detectStopWord(body.body)) {
      return { ok: true, data: { stopWordDetected: true, optOutCandidate: true } };
    }
    return { ok: true, data: inbox.receiveReply(body) };
  }
  if (method === "POST" && String(body.channel || "").toLowerCase() === "sms" && env?.CONCIERGE) {
    const contactId = String(body.contactId || "").trim();
    const message = String(body.body || body.message || "").trim();
    if (!contactId) return { ok:false, error:"contactId required" };
    if (!message) return { ok:false, error:"SMS message is required" };
    const contact = contacts.list().find(row => row.id === contactId);
    if (!contact) return { ok:false, error:"Contact not found" };
    if (!contact.phone) return { ok:false, error:"Contact has no phone number" };
    if (contact.optedOut || contact.smsConsent === false) return { ok:false, error:"Contact has opted out of SMS" };

    let result;
    try {
      result = await conciergePost(env, "/internal/messages", {
        contactId,
        contact,
        channel:"sms",
        message,
        messageType:"ebc-dashboard-manual",
        source:"ebc-operations-dashboard",
      });
    } catch (error) {
      result = { ok:false, error:error.message };
    }

    activity.record({
      type:result?.ok ? "sms.sent" : "sms.failed",
      entityType:"contact",
      entityId:contactId,
      message:result?.ok ? "Dashboard SMS accepted by Twilio" : "Dashboard SMS failed",
      metadata:{ source:"ebc-operations-dashboard", provider:result?.sms?.provider || "", messageSid:result?.sms?.messageSid || "", error:result?.error || result?.sms?.error || "" },
    });

    return result?.ok
      ? { ok:true, data:result }
      : { ok:false, error:result?.error || result?.sms?.error || "Twilio did not accept the SMS" };
  }
  if (method === "POST") return { ok: true, data: await inbox.send(body) };
  return { ok: false, error: "Unsupported inbox operation" };
};
