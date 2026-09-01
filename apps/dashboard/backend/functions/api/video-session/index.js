const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { readDb } = require("../../../layers/core/db");
const { conciergePost } = require("../../../../shared/services/concierge");
const rateLimits = require("../../../layers/domain/rateLimits");

function videoHistory(contactId) {
  if (!contactId) return { messages:[] };
  const messages = (readDb().messages || [])
    .filter((message) => message?.contactId === contactId && message?.channel === "video")
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
    .slice(-60)
    .map((message) => ({
      role:message.direction === "inbound" ? "customer" : "buddy",
      text:String(message.body || "").slice(0, 4000),
      segmentId:String(message.providerMessageId || message.id || "").slice(0, 240),
      at:new Date(message.createdAt || Date.now()).getTime(),
    }))
    .filter((message) => message.text);
  return { messages };
}

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };
  const guard = rateLimits.checkAndTrack("ebc-support-video");
  if (!guard.allowed) return { ok:false, error:`Video demo limit reached. ${guard.reason}. Please try again shortly.` };

  const contactId = String(body?.contactId || "").trim();
  const contact = contactId ? readDb().contacts.find((row) => row && row.id === contactId) || null : null;
  if (contactId && !contact) return { ok:false, error:"Contact not found" };

  const context = contact || {
    firstName:String(body?.firstName || "").slice(0, 80),
    lastName:String(body?.lastName || "").slice(0, 80),
    company:String(body?.company || "").slice(0, 160),
    interest:String(body?.interest || "").slice(0, 180),
    location:String(body?.location || "").slice(0, 120),
    leadScore:Number(body?.leadScore || 0),
  };

  if (contact) {
    contacts.update(contact.id, { callStatus:"Video support requested" });
    activity.record({
      type:"video.requested",
      entityType:"contact",
      entityId:contact.id,
      message:`EBC support video requested for ${contact.company || contact.firstName || contact.email || contact.phone}`,
      metadata:{ source:body?.source || "ebc-dashboard-support", interest:contact.interest, location:contact.location },
    });
  }

  try {
    const result = await conciergePost(env, "/internal/video/session", {
      contactId,
      contact:contact || context,
      context,
      source:body?.source || "ebc-dashboard-support",
    });
    if (result?.ok === false) return { ok:false, error:result.error || "Video session failed" };
    return { ok:true, ...result, history:videoHistory(contactId) };
  } catch (error) {
    return { ok:false, error:error.message || "Unable to create the EBC support room" };
  }
};
