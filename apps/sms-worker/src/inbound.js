export function isEbcCallbackReply(value = "") {
  return /^ebc(?:\s+(?:call|call me|please|now))?[.!?]*$/i.test(String(value || "").trim());
}

export function inboundSmsTarget(env = {}, body = {}) {
  const reply = String(body.Body || body.body || "").trim();
  const ebcUrl = String(env.EBC_SMS_WEBHOOK_URL || "").trim();
  return {
    pipeline:"ebc",
    reply,
    url:ebcUrl,
  };
}

export async function twilioFormSignature(url, body = {}, authToken = "") {
  let signed = String(url || "");
  for (const key of Object.keys(body).sort()) signed += `${key}${body[key] ?? ""}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(authToken || "")),
    { name:"HMAC", hash:"SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signed)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function validateTwilioFormRequest(request, body = {}, authToken = "") {
  const provided = String(request.headers.get("x-twilio-signature") || "");
  if (!authToken || !provided) return false;
  const url = new URL(request.url);
  const canonicalUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  return provided === await twilioFormSignature(canonicalUrl, body, authToken);
}
