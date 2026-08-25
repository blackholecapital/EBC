const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signContactId(secret, contactId) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`buddy-call:${contactId}`));
  return base64Url(new Uint8Array(signature));
}

async function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function callPage({ ok, title, message }) {
  const accent = ok ? "#16875b" : "#c62828";
  const symbol = ok ? "&#10003;" : "!";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111111"><title>${escapeHtml(title)} · Everything Built Custom</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f4f5;color:#18181b;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,520px);overflow:hidden;border:1px solid #dedee2;border-radius:20px;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,.12)}.brand{padding:22px 26px;background:#111;color:#fff;border-bottom:5px solid #1c75bc;font-weight:900;letter-spacing:.04em}.brand b{color:#1c75bc}.content{padding:38px 30px 34px;text-align:center}.icon{width:66px;height:66px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center;background:${accent}18;color:${accent};font-size:34px;font-weight:900;border:1px solid ${accent}40}h1{margin:0 0 12px;font-size:clamp(26px,8vw,38px);line-height:1.05}p{margin:0 auto;max-width:390px;color:#606066;font-size:17px;line-height:1.55}.hint{display:block;margin-top:25px;color:#929298;font-size:13px}</style></head>
<body><main class="card"><div class="brand"><b>EBC</b> HOST · AI CONCIERGE</div><section class="content"><div class="icon">${symbol}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><span class="hint">You can safely close this page.</span></section></main></body></html>`;
}

function pageResult(ok, status, title, message) {
  return { ok, status, responseType:"html", html:callPage({ ok, title, message }) };
}

module.exports = async function handler({ method, params, env }) {
  if (method !== "GET") return pageResult(false, 405, "This link cannot be opened", "Please use the call link from your Everything Built Custom email.");

  const contactId = String(params.id || "");
  const provided = String(params.sig || "");
  if (!contactId || !provided || !env.INTERNAL_CALL_SECRET) {
    return pageResult(false, 400, "This call link is unavailable", "Please return to your Everything Built Custom email and try the latest link.");
  }

  const expected = await signContactId(env.INTERNAL_CALL_SECRET, contactId);
  if (!(await safeEqual(provided, expected))) {
    return pageResult(false, 400, "This call link is unavailable", "Please return to your Everything Built Custom email and try the latest link.");
  }

  const contact = contacts.list().find((row) => row && row.id === contactId) || null;
  if (!contact) return pageResult(false, 404, "We could not find this request", "Please submit a new request or contact the Everything Built Custom sales team.");
  if (!contact.phone) return pageResult(false, 400, "A phone number is needed", "Please update your request with a phone number before asking EBC AI to call.");
  if (contact.optedOut) return pageResult(false, 400, "Calling is disabled", "This contact has opted out of automated communication.");

  activity.record({
    type:"call.requested",
    entityType:"contact",
    entityId:contact.id,
    message:`EBC AI email call-now requested for ${contact.firstName || "Everything Built Custom prospect"}`,
    metadata:{ source:"ebc-email-call-link" },
  });

  try {
    const result = await conciergePost(env, "/internal/calls", {
      contactId:contact.id,
      contact,
      trigger:{ type:"email-call-link", preferredContactMethod:"Email" },
    });
    if (!result?.ok) throw new Error(result?.error || result?.result?.error || "The call could not be started");
    return pageResult(true, 200, "EBC AI is calling you now", "Keep your phone nearby. Your Everything Built Custom AI concierge call has been queued and should arrive momentarily.");
  } catch (error) {
    return pageResult(false, 502, "We could not start the call", "Please wait a moment and use the call link again, or reply EBC to the latest text message.");
  }
};

module.exports.callPage = callPage;
