import { handleTwilioMediaSocket } from "./media.js";
import { eilaRuntimeEnabled } from "./eila-runtime.js";
import { hydrateSharedSecrets } from "../../shared/cloudflare-secrets.mjs";

const SHARED_SECRET_MAPPINGS = [
  { target:"TWILIO_ACCOUNT_SID", binding:"SHARED_TWILIO_ACCOUNT_SID" },
  { target:"TWILIO_AUTH_TOKEN", binding:"SHARED_TWILIO_AUTH_TOKEN" },
  { target:"DEEPGRAM_API_KEY", binding:"SHARED_DEEPGRAM_API_KEY" },
  { target:"EILA_RUNTIME_TOKEN", binding:"SHARED_RUNTIME_TOKEN" },
  { target:"BUDDY_RUNTIME_TOKEN", binding:"SHARED_RUNTIME_TOKEN" },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function xml(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactParam(value = "", max = 240) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function tenantContext(env, event = {}) {
  const payload=event.payload||{},contact=payload.contact||event.contact||{};
  return {
    tenantId:String(event.tenantId||payload.tenantId||env.TENANT_ID||"blackhole"),
    corporateId:String(event.corporateId||payload.corporateId||env.CORPORATE_ID||env.TENANT_ID||"blackhole"),
    locationId:String(event.locationId||payload.locationId||contact.locationId||contact.location_id||env.DEFAULT_LOCATION_ID||"corporate"),
  };
}

function basicAuth(accountSid, authToken) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

async function secretsEqual(a, b) {
  const left = await sha256(a);
  const right = await sha256(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function authorizeInternalCall(request, env) {
  const configured = env.INTERNAL_CALL_SECRET || "";
  if (!configured) return { ok:false, response:json({ ok:false, error:"Internal call authentication is not configured" }, 503) };
  const provided = request.headers.get("x-internal-call-secret") || "";
  if (!provided || !(await secretsEqual(provided, configured))) return { ok:false, response:json({ ok:false, error:"Unauthorized" }, 401) };
  return { ok:true };
}

async function parseBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await request.json();
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(await request.text()));
  const text = await request.text();
  try { return JSON.parse(text); } catch { return { raw:text }; }
}

async function emitEvent(env, event) {
  const tenant=tenantContext(env,event),tagged={...event,...tenant,ts:Date.now()};
  try { if (env.EVENTS) await env.EVENTS.send(tagged); } catch (error) { console.error("queue event failed", error); }
  try {
    if (env.ANALYTICS) env.ANALYTICS.writeDataPoint({ blobs:[event.type || "voice.event", event.contactId || "", event.callSid || "",tenant.tenantId,tenant.corporateId,tenant.locationId], doubles:[Date.now()], indexes:[tenant.tenantId] });
  } catch (error) { console.error("analytics event failed", error); }
}

async function validateTwilioFormRequest(request, env, body) {
  const authToken = String(env.TWILIO_AUTH_TOKEN || "");
  const provided = String(request.headers.get("x-twilio-signature") || "");
  if (!authToken || !provided) return false;
  const url = new URL(request.url);
  const canonicalUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  const keys = Object.keys(body || {}).sort();
  let signed = canonicalUrl;
  for (const key of keys) signed += `${key}${body[key] ?? ""}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name:"HMAC", hash:"SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  return expected === provided;
}

async function forwardSmsReply(env, body) {
  const secret = String(env.INTERNAL_CALL_SECRET || "");
  if (!secret) throw new Error("INTERNAL_CALL_SECRET is not configured");

  const payload = {
    from:body.From || body.from || "",
    body:body.Body || body.body || "",
    messageSid:body.MessageSid || "",
  };

  const request = new Request("https://concierge.internal/internal/sms-reply", {
    method:"POST",
    headers:{ "content-type":"application/json", "x-internal-call-secret":secret },
    body:JSON.stringify(payload),
  });

  const response = env.CONCIERGE
    ? await env.CONCIERGE.fetch(request)
    : await fetch(`${String(env.CONCIERGE_PUBLIC_URL || "https://ebc-concierge-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/, "")}/internal/sms-reply`, {
        method:"POST",
        headers:{ "content-type":"application/json", "x-internal-call-secret":secret },
        body:JSON.stringify(payload),
      });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
  if (!response.ok) {
    console.error("Concierge SMS reply handoff rejected", {
      status:response.status,
      body:data,
      via:env.CONCIERGE ? "service-binding" : "public-fetch",
    });
    throw new Error(data?.error || `Concierge SMS reply failed (${response.status})`);
  }
  return data;
}

function buildRealtimeTwiml(env, context) {
  const streamUrl = String(env.MEDIA_STREAM_URL || "").trim();
  if (!streamUrl.startsWith("wss://")) return null;
  const streamStatusUrl = `${env.PUBLIC_BASE_URL}/twilio/stream-status`;
  const params = [
    ["contactId", context.contactId], ["firstName", context.firstName], ["lastName", context.lastName],
    ["email", context.email], ["phone", context.phone], ["interest", context.interest], ["location", context.location],
    ["comments", context.comments], ["leadScore", context.leadScore], ["preferredContactTime", context.preferredContactTime],
    ["triggerType", context.triggerType], ["tenantId", context.tenantId], ["corporateId", context.corporateId], ["locationId", context.locationId],
  ];
  const customParameters = params
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([name, value]) => `      <Parameter name="${escapeXml(name)}" value="${escapeXml(compactParam(value))}"/>`)
    .join("\n");
  return `<Response>\n  <Connect>\n    <Stream url="${escapeXml(streamUrl)}" statusCallback="${escapeXml(streamStatusUrl)}" statusCallbackMethod="POST">\n${customParameters}\n    </Stream>\n  </Connect>\n</Response>`;
}

function buildFallbackTwiml(env, context) {
  const assistant=escapeXml(env.ASSISTANT_NAME||"EBC AI"),brand=escapeXml(env.BRAND_NAME||"Everything Built Custom");
  return `<Response><Pause length="1"/><Say voice="Polly.Joanna">Hi ${escapeXml(context.firstName)}. This is ${assistant}, the ${brand} AI assistant. I saw that you're interested in ${escapeXml(context.interest)}. I'm calling because you asked to speak with me. The live conversational assistant is connecting now.</Say><Pause length="1"/><Say voice="Polly.Joanna">Thanks. Your lead information successfully reached our voice system.</Say></Response>`;
}

export default {
  async fetch(request, env, ctx) {
    env = await hydrateSharedSecrets(env, SHARED_SECRET_MAPPINGS);
    const url = new URL(request.url);

    if (url.pathname === "/twilio/media") return handleTwilioMediaSocket(request, env, ctx);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok:true, service:env.TENANT_ID === "ebc" ? "ebc-voice-worker" : "blackhole-voice-worker", status:"online", tenant:tenantContext(env), voice:"twilio", realtime:String(env.MEDIA_STREAM_URL || "").startsWith("wss://") ? "configured" : "fallback", mediaBridge:"ready", voiceRuntime:eilaRuntimeEnabled(env)?"eila-streaming":"legacy-fallback", eilaRuntimeUrlConfigured:Boolean(env.EILA_RUNTIME_URL||env.BUDDY_RUNTIME_URL), conciergeBinding:Boolean(env.CONCIERGE) });
    }

    if (url.pathname === "/twilio/sms" && request.method === "POST") {
      const body = await parseBody(request);
      if (!(await validateTwilioFormRequest(request, env, body))) return xml("<Response></Response>", 403);
      try {
        const result = await forwardSmsReply(env, body);
        console.log("EBC inbound SMS processed", { from:body.From || "", body:body.Body || "", action:result?.action || "none" });
        return xml("<Response></Response>");
      } catch (error) {
        console.error("EBC inbound SMS failed", { from:body.From || "", error:error.message });
        return xml("<Response></Response>");
      }
    }

    if (url.pathname === "/internal/calls" && request.method === "POST") {
      const auth = await authorizeInternalCall(request, env);
      if (!auth.ok) return auth.response;
      const payload = await parseBody(request);
      const ctxIn = payload.context || {};
      const contact = payload.contact || {};
      const lead = payload.lead || {};
      const phone = payload.phone || contact.phone || ctxIn.phone || lead.phone;
      if (!phone) return json({ ok:false, error:"Missing customer phone number" }, 400);
      const contactId = payload.contactId || contact.id || ctxIn.contactId || "";
      const firstName = payload.firstName || contact.firstName || ctxIn.firstName || payload.name?.split?.(" ")?.[0] || "there";
      const lastName = payload.lastName || contact.lastName || ctxIn.lastName || "";
      const email = payload.email || contact.email || ctxIn.email || lead.email || "";
      const interest = payload.interest || payload.productInterest || contact.interest || ctxIn.interest || lead.product_interest || lead.interest || "your recent inquiry";
      const location = payload.location || payload.preferredStore || contact.location || ctxIn.location || lead.preferred_store || "";
      const leadScore = payload.leadScore ?? payload.score ?? contact.leadScore ?? ctxIn.leadScore ?? "";
      const comments = payload.comments || contact.comments || ctxIn.comments || lead.comments || "";
      const preferredContactTime = payload.preferredContactTime || contact.preferredContactTime || ctxIn.preferredContactTime || lead.contact_time || "";
      const accountSid = env.TWILIO_ACCOUNT_SID;
      const authToken = env.TWILIO_AUTH_TOKEN;
      const fromNumber = env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromNumber) return json({ ok:false, error:"Twilio secrets are not configured" }, 500);
      const triggerType = String(payload.trigger?.type || ctxIn.triggerType || "");
      const context = { contactId, firstName, lastName, email, phone, interest, location, comments, leadScore, preferredContactTime, triggerType, ...tenantContext(env, payload) };
      const realtimeTwiml = buildRealtimeTwiml(env, context);
      const twiml = realtimeTwiml || buildFallbackTwiml(env, context);
      const mode = realtimeTwiml ? "media-stream" : "fallback-say";
      const callbackUrl = `${env.PUBLIC_BASE_URL}/twilio/status?contactId=${encodeURIComponent(contactId)}`;
      const params = new URLSearchParams();
      params.set("To", phone); params.set("From", fromNumber); params.set("Twiml", twiml); params.set("StatusCallback", callbackUrl); params.set("StatusCallbackMethod", "POST");
      for (const eventName of ["initiated", "ringing", "answered", "completed"]) params.append("StatusCallbackEvent", eventName);
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
        method:"POST", headers:{ Authorization:basicAuth(accountSid, authToken), "content-type":"application/x-www-form-urlencoded" }, body:params.toString(),
      });
      const result = await response.json();
      if (!response.ok) {
        console.error("Twilio call failed", result);
        await emitEvent(env, { type:"call.failed", contactId, phone, error:result.message || "Twilio call failed", mode });
        return json({ ok:false, error:"Twilio call creation failed", twilio:result }, response.status);
      }
      await emitEvent(env, { type:"call.created", contactId, callSid:result.sid, phone, interest, location, leadScore:String(leadScore), comments, mode });
      return json({ ok:true, provider:"twilio", callSid:result.sid, status:result.status, contactId, phone, mode, context });
    }

    if (url.pathname === "/twilio/status" && request.method === "POST") {
      const body = await parseBody(request);
      const contactId = url.searchParams.get("contactId") || "";
      const callSid = body.CallSid || body.callSid || "";
      const status = body.CallStatus || body.callStatus || "unknown";
      await emitEvent(env, { type:`call.${status}`, contactId, callSid, status, duration:body.CallDuration || body.Duration || "" });
      console.log("Twilio call status", { contactId, callSid, status });
      return json({ ok:true });
    }

    if (url.pathname === "/twilio/stream-status" && request.method === "POST") {
      const body = await parseBody(request);
      const streamEvent = body.StreamEvent || "unknown";
      const callSid = body.CallSid || "";
      const streamSid = body.StreamSid || "";
      await emitEvent(env, { type:`stream.${streamEvent}`, callSid, streamSid, streamEvent, streamError:body.StreamError || "" });
      console.log("Twilio stream status", { callSid, streamSid, streamEvent, streamError:body.StreamError || "" });
      return json({ ok:true });
    }

    if (url.pathname === "/twilio/answer") {
      const realtimeTwiml = buildRealtimeTwiml(env, { contactId:"", firstName:"there", interest:"your recent inquiry", location:"", leadScore:"" });
      if (realtimeTwiml) return xml(realtimeTwiml);
      return xml(`<Response><Say voice="Polly.Joanna">${escapeXml(env.ASSISTANT_NAME || "AI Concierge")} voice service is online.</Say></Response>`);
    }

    return json({ ok:false, error:"Route not found", path:url.pathname }, 404);
  },
};
