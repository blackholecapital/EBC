const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");
const { initialLeadScore, baselineOpportunityValue } = require("../../../layers/domain/lead-intelligence");

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function buildCallNowUrl(env, contactId) {
  if (!env.INTERNAL_CALL_SECRET || !contactId) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(env.INTERNAL_CALL_SECRET)),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`buddy-call:${contactId}`));
  const sig = base64Url(new Uint8Array(signature));
  const base = String(env.DASHBOARD_PUBLIC_URL || "https://blackhole-dashboard-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/, "");
  return `${base}/api/call-now?id=${encodeURIComponent(contactId)}&sig=${encodeURIComponent(sig)}`;
}

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const scoreInput = {
    firstName:body.first_name || body.firstName || "", lastName:body.last_name || body.lastName || "",
    company:body.company || "", phone:body.phone || "", email:body.email || "",
    interest:body.product_interest || "", location:body.preferred_store || "",
    preferredContactMethod:body.contact_method || body.preferredContactMethod || "",
    preferredContactTime:body.contact_time || "", comments:body.comments || "",
    leadSource:body.lead_source || "", consent:body.consent,
  };
  const leadScore = initialLeadScore(scoreInput).score;
  const preferredContactMethod = body.contact_method || body.preferredContactMethod || "";
  const tenantId = body.tenantId || env.TENANT_ID || "blackhole";
  const corporateId = body.corporateId || env.CORPORATE_ID || tenantId;
  const locationId = body.location_id || body.locationId || env.DEFAULT_LOCATION_ID || "corporate";
  const brandName = env.BRAND_NAME || "Everything Built Custom";

  let contact = contacts.create({
    firstName: body.first_name || body.firstName || "",
    lastName: body.last_name || body.lastName || "",
    email: body.email || "",
    phone: body.phone || "",
    channelPreference: preferredContactMethod === "Email" ? "email" : "sms",
    interest: body.product_interest || "",
    leadSource: body.lead_source || "",
    location: body.preferred_store || "",
    preferredContactMethod,
    preferredContactTime: body.contact_time || "",
    comments: body.comments || "",
    smsConsent: body.consent === true || body.consent === "true" || body.consent === "on",
    owner: body.owner || `${brandName} Web Lead`,
    company: body.company || "",
    source: `${brandName} web lead`,
    tenantId,
    corporateId,
    locationId,
    leadScore,
    initialLeadScore:leadScore,
    value:baselineOpportunityValue(scoreInput),
    stage: "New Lead",
    outreachStatus: "Pending",
    callStatus: "Not called",
    documentStatus: "Not sent"
  });

  activity.record({
    type:"lead.created",
    entityType:"lead",
    entityId:contact.id,
    message:`${brandName} web lead: ${contact.firstName} ${contact.lastName}`,
    metadata:{ ...body, leadScore, tenantId, corporateId, locationId }
  });

  const callNowUrl = contact.email ? await buildCallNowUrl(env, contact.id) : "";

  let concierge = null;
  try {
    concierge = await conciergePost(env, "/internal/leads", {
      contactId:contact.id,
      contact,
      lead:{ ...body, leadScore },
      tenantId,
      corporateId,
      locationId,
      callback:{ callNowUrl, persistent:true, source:"lead-email" },
    });
  } catch(err) {
    concierge = { ok:false, error:err.message };
  }

  const smsSent = concierge?.results?.sms?.ok === true;
  const emailSent = concierge?.results?.email?.ok === true;
  if (smsSent || emailSent) {
    contact = contacts.update(contact.id, {
      stage:"Contacted",
      outreachStatus:"Sent",
      outreachChannels:[smsSent ? "sms" : null, emailSent ? "email" : null].filter(Boolean),
    }) || contact;
    activity.record({
      type:"lead.contacted",
      entityType:"lead",
      entityId:contact.id,
      message:`${brandName} outreach sent to ${contact.firstName || contact.phone || contact.email}`,
      metadata:{ smsSent, emailSent, preferredContactMethod, contactFlow:concierge?.contactFlow || null, tenantId, corporateId, locationId },
    });
  }

  return {
    ok:true,
    contact,
    leadScore,
    concierge,
    contactFlow: concierge?.contactFlow || null,
    callNowUrl: callNowUrl || undefined,
  };
};
