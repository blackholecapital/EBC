import { inboundSmsTarget, twilioFormSignature, validateTwilioFormRequest } from "./inbound.js";
import { hydrateSharedSecrets } from "../../shared/cloudflare-secrets.mjs";

const SHARED_SECRET_MAPPINGS = [
  { target:"TWILIO_ACCOUNT_SID", binding:"SHARED_TWILIO_ACCOUNT_SID" },
  { target:"TWILIO_AUTH_TOKEN", binding:"SHARED_TWILIO_AUTH_TOKEN" },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function xml(body = "<Response></Response>", status = 200) {
  return new Response(body, {
    status,
    headers:{ "content-type":"text/xml; charset=utf-8", "cache-control":"no-store" },
  });
}

function basicAuth(accountSid, authToken) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

function normalizePhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

function resolveMessage(payload = {}) {
  return String(payload.message || payload.body || payload.text || payload.sms?.message || "").trim();
}

function resolvePhone(payload = {}) {
  return normalizePhone(payload.to || payload.phone || payload.contact?.phone || payload.lead?.phone || "");
}

function maskPhone(value = "") {
  const phone = normalizePhone(value);
  if (phone.length < 4) return phone;
  return `${phone.slice(0, 3)}••••${phone.slice(-4)}`;
}

function tenantContext(env, event = {}) {
  const payload = event.payload || {};
  const contact = payload.contact || event.contact || {};
  return {
    tenantId:String(event.tenantId || payload.tenantId || env.TENANT_ID || "blackhole"),
    corporateId:String(event.corporateId || payload.corporateId || env.CORPORATE_ID || env.TENANT_ID || "blackhole"),
    locationId:String(event.locationId || payload.locationId || contact.locationId || contact.location_id || env.DEFAULT_LOCATION_ID || "corporate"),
  };
}

async function emit(env, event) {
  const tenant = tenantContext(env, event);
  const tagged = { ...event, ...tenant, ts:Date.now() };
  if (env.EVENTS) {
    try { await env.EVENTS.send(tagged); } catch (error) { console.error("SMS event emit failed", error); }
  }
  if (env.ANALYTICS) {
    try { env.ANALYTICS.writeDataPoint({ blobs:[event.type || "sms.event", event.contactId || "", event.messageType || "", tenant.tenantId, tenant.corporateId, tenant.locationId], doubles:[Date.now()], indexes:[tenant.tenantId] }); } catch {}
  }
}

async function parseRequestBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json().catch(() => ({}));
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(await request.text()));
  const text = await request.text();
  try { return JSON.parse(text); } catch { return { raw:text }; }
}

async function sendSms(env, payload = {}) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || "");
  const authToken = String(env.TWILIO_AUTH_TOKEN || "");
  const from = normalizePhone(env.TWILIO_PHONE_NUMBER || "");
  const to = resolvePhone(payload);
  const message = resolveMessage(payload);
  const contactId = String(payload.contactId || payload.contact?.id || "");
  const messageType = String(payload.messageType || "buddy-sms");

  if (!accountSid || !authToken || !from) return json({ ok:false, error:"Twilio SMS credentials are not configured" }, 503);
  if (!to) return json({ ok:false, error:"Missing SMS destination phone number" }, 400);
  if (!message) return json({ ok:false, error:"Missing SMS message body" }, 400);

  const publicBase = String(env.PUBLIC_BASE_URL || "https://blackhole-sms-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/, "");
  const callback = new URL(`${publicBase}/twilio/status`);
  if (contactId) callback.searchParams.set("contactId", contactId);
  if (messageType) callback.searchParams.set("messageType", messageType);

  const body = new URLSearchParams();
  body.set("To", to);
  body.set("From", from);
  body.set("Body", message);
  body.set("StatusCallback", callback.toString());

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method:"POST",
    headers:{ Authorization:basicAuth(accountSid, authToken), "content-type":"application/x-www-form-urlencoded" },
    body:body.toString(),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Buddy SMS Twilio API rejected", { status:response.status, code:result.code || null, message:result.message || "Twilio SMS request failed", from:maskPhone(from), to:maskPhone(to), messageType, contactId });
    await emit(env, { type:"sms.failed", contactId, messageType, to:maskPhone(to), provider:"twilio", providerCode:result.code || null, error:result.message || "Twilio SMS request failed" });
    return json({ ok:false, provider:"twilio", status:response.status, code:result.code || null, error:result.message || "Twilio SMS request failed", from:maskPhone(from), to:maskPhone(to) }, response.status);
  }

  console.log("Buddy SMS accepted by Twilio", { sid:result.sid || "", from:maskPhone(from), to:maskPhone(to), twilioStatus:result.status || "queued", messageType, contactId });
  await emit(env, { type:"sms.sent", contactId, messageType, messageSid:result.sid || "", status:result.status || "queued", to:maskPhone(to), provider:"twilio", message });

  return json({ ok:true, provider:"twilio", messageSid:result.sid || "", status:result.status || "queued", from:maskPhone(from), to:maskPhone(to), messageType });
}

async function routeInboundSms(env, body = {}) {
  const authToken = String(env.TWILIO_AUTH_TOKEN || "");
  const target = inboundSmsTarget(env, body);
  if (!target.url) throw new Error(`${target.pipeline.toUpperCase()} inbound SMS webhook is not configured`);

  const signature = await twilioFormSignature(target.url, body, authToken);
  const response = await fetch(target.url, {
    method:"POST",
    headers:{
      "content-type":"application/x-www-form-urlencoded",
      "x-twilio-signature":signature,
    },
    body:new URLSearchParams(body).toString(),
  });
  const responseText = await response.text();
  console.log("Inbound SMS routed", {
    pipeline:target.pipeline,
    from:maskPhone(body.From || ""),
    messageSid:body.MessageSid || "",
    status:response.status,
  });
  await emit(env, {
    type:"sms.reply.routed",
    from:maskPhone(body.From || ""),
    messageSid:body.MessageSid || "",
    messageType:`${target.pipeline}-sms-reply`,
    pipeline:target.pipeline,
  });
  if (!response.ok) throw new Error(`${target.pipeline} SMS webhook rejected the reply (${response.status}): ${responseText.slice(0, 180)}`);
  return { pipeline:target.pipeline, status:response.status };
}

export default {
  async fetch(request, env) {
    env = await hydrateSharedSecrets(env, SHARED_SECRET_MAPPINGS);
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/api/health") {
      const from = normalizePhone(env.TWILIO_PHONE_NUMBER || "");
      return json({ ok:true, service:"ebc-sms-worker", provider:"twilio", health:"online", tenant:tenantContext(env), configured:Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER), inboundRouterConfigured:Boolean(env.EBC_SMS_WEBHOOK_URL), inboundWebhook:`${String(env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/twilio/sms`, fromNumberMasked:maskPhone(from), fromLast4:from.slice(-4) });
    }

    if (url.pathname === "/internal/send" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      return sendSms(env, payload);
    }

    if ((url.pathname === "/twilio/sms" || url.pathname === "/twilio/incoming") && request.method === "POST") {
      const body = await parseRequestBody(request);
      if (!(await validateTwilioFormRequest(request, body, String(env.TWILIO_AUTH_TOKEN || "")))) {
        console.warn("Inbound SMS signature rejected", { path:url.pathname, from:maskPhone(body.From || "") });
        return xml("<Response></Response>", 403);
      }
      try {
        await routeInboundSms(env, body);
        return xml();
      } catch (error) {
        console.error("Inbound SMS routing failed", { from:maskPhone(body.From || ""), error:error?.message || String(error) });
        return xml("<Response></Response>", 502);
      }
    }

    if (url.pathname === "/twilio/status" && request.method === "POST") {
      const body = await parseRequestBody(request);
      const status = body.MessageStatus || body.SmsStatus || body.status || "unknown";
      const sid = body.MessageSid || body.SmsSid || body.sid || "";
      const errorCode = body.ErrorCode || body.error_code || "";
      const errorMessage = body.ErrorMessage || body.error_message || "";
      const contactId = url.searchParams.get("contactId") || "";
      const messageType = url.searchParams.get("messageType") || "buddy-sms";
      console.log("Buddy SMS delivery status", { sid, status, errorCode:errorCode || null, errorMessage:errorMessage || null, from:maskPhone(body.From || ""), to:maskPhone(body.To || ""), contactId, messageType });
      await emit(env, { type:`sms.${status}`, contactId, messageType, messageSid:sid, status, to:maskPhone(body.To || ""), provider:"twilio", errorCode:errorCode || "", error:errorMessage || "" });
      return json({ ok:true });
    }

    return json({ ok:false, error:"Route not found", path:url.pathname }, 404);
  },
};
