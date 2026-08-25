const RESEND_URL = "https://api.resend.com/emails";

import { hydrateSharedSecrets } from "../../shared/cloudflare-secrets.mjs";

const SHARED_SECRET_MAPPINGS = [
  { target:"RESEND_API_KEY", binding:"SHARED_RESEND_API_KEY" },
];

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function brandName(env) { return String(env.BRAND_NAME || "Everything Built Custom"); }
function assistantName(env) { return String(env.ASSISTANT_NAME || "EBC AI"); }
function brandColor(env) { return String(env.BRAND_PRIMARY_COLOR || "#1c75bc"); }
function brandUrl(env) { return String(env.BRAND_URL || "https://everythingbuiltcustom.com"); }
function tenantContext(env, event = {}) { const payload=event.payload||{},contact=payload.contact||event.contact||{};return{tenantId:String(event.tenantId||payload.tenantId||env.TENANT_ID||"blackhole"),corporateId:String(event.corporateId||payload.corporateId||env.CORPORATE_ID||env.TENANT_ID||"blackhole"),locationId:String(event.locationId||payload.locationId||contact.locationId||contact.location_id||env.DEFAULT_LOCATION_ID||"corporate")}; }
function money(value=0,currency="USD"){return new Intl.NumberFormat("en-US",{style:"currency",currency}).format(Number(value||0));}
function quoteDate(value=new Date()){return new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:"America/New_York"}).format(value);}
function firstValue(...values){return values.find(value=>String(value||"").trim())||"";}

function shell(env, title, inner) {
  const brand = brandName(env);
  const accent = brandColor(env);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;"><tr><td align="center">
  <table width="650" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #d9e3f5;overflow:hidden;">
  <tr><td style="background:${esc(accent)};color:#fff;padding:28px;text-align:center;"><h1 style="margin:0;font-size:30px;">${esc(brand)}</h1><div style="margin-top:6px;font-size:15px;opacity:.9;">${esc(title)}</div></td></tr>
  <tr><td style="padding:32px;">${inner}</td></tr>
  <tr><td style="background:${esc(accent)};color:#fff;text-align:center;padding:18px;font-size:13px;">${esc(brand)}<br>${esc(brandUrl(env))}</td></tr>
  </table></td></tr></table></body></html>`;
}

async function emit(env, event) {
  const tenant=tenantContext(env,event),tagged={...event,...tenant,ts:Date.now()};
  if (env.EVENTS) { try { await env.EVENTS.send(tagged); } catch (error) { console.error("Email event emit failed", error); } }
  if (env.ANALYTICS) { try { env.ANALYTICS.writeDataPoint({blobs:[event.type||"email.event",event.contactId||"",event.messageType||"",tenant.tenantId,tenant.corporateId,tenant.locationId],doubles:[Date.now()],indexes:[tenant.tenantId]}); } catch {} }
}

export default {
  async fetch(request, env) {
    env = await hydrateSharedSecrets(env, SHARED_SECRET_MAPPINGS);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status:204 });
    if (url.pathname === "/api/health") return Response.json({ ok:true, service:env.TENANT_ID === "ebc" ? "ebc-email-worker" : "blackhole-email-worker", provider:"resend", health:"online", configured:Boolean(env.RESEND_API_KEY&&env.FROM_EMAIL), fromConfigured:Boolean(env.FROM_EMAIL), tenant:tenantContext(env) });
    if (url.pathname !== "/internal/send" || request.method !== "POST") return Response.json({ ok:false, error:"Route not found" }, { status:404 });

    const payload = await request.json();
    const contact = payload.contact || {};
    const lead = payload.lead || {};
    const contactId = String(payload.contactId || contact.id || "");
    const messageType = String(payload.messageType || "buddy-welcome");
    const callNowUrl = String(payload.callback?.callNowUrl || "").trim();
    const signingUrl = String(payload.docusign?.signingUrl || payload.signingUrl || "").trim();
    const productName = payload.product?.name || payload.productName || contact.selectedProduct || "your selected item";
    const delivery = payload.delivery || {};
    const appointment = payload.appointment || {};
    const brand = brandName(env);
    const assistant = assistantName(env);
    const accent = brandColor(env);
    const estimateCallbackBlock = callNowUrl ? `
      <div style="margin:28px 0;padding:24px;background:#f2f8fc;border:1px solid #f1caca;border-radius:8px;text-align:center;">
        <h3 style="margin:0 0 10px;color:${esc(accent)};">Questions or changes?</h3>
        <p style="margin:0 0 18px;line-height:1.5;">Have ${esc(assistant)} call you to review this estimate, answer questions, or capture requested changes.</p>
        <a href="${esc(callNowUrl)}" style="display:inline-block;background:${esc(accent)};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:6px;">Have ${esc(assistant)} Call Me About This Estimate</a>
        <p style="margin:14px 0 0;font-size:12px;color:#666;">This link stays available whenever you want to continue the conversation.</p>
      </div>` : "";

    let subject;
    let html;

    if (messageType === "ebc-preliminary-estimate") {
      const quote = payload.quote || {};
      const currency = quote.currency || "USD";
      const created = new Date(quote.createdAt || Date.now());
      const validUntil = quote.validUntil ? new Date(quote.validUntil) : new Date(created.getTime() + Math.max(1, Number(quote.validityDays || 30)) * 86400000);
      const lines = Array.isArray(quote.lineItems) ? quote.lineItems : [];
      const requirements = Array.isArray(payload.requirements) ? payload.requirements.join(" ") : String(payload.requirements || "");
      const estimateNumber = String(quote.estimateNumber || `EBC-${String(contactId || Date.now()).replace(/[^A-Za-z0-9]/g,"").slice(-10).toUpperCase()}`);
      const company = firstValue(contact.company, contact.companyName, contact.businessName);
      const address1 = firstValue(contact.addressLine1, contact.address1, contact.street);
      const address2 = firstValue(contact.addressLine2, contact.address2);
      const city = firstValue(contact.city);
      const region = firstValue(contact.state, contact.region);
      const postal = firstValue(contact.postalCode, contact.zip);
      const country = firstValue(contact.country, "United States");
      const recipientLines = [
        company,
        [contact.firstName, contact.lastName].filter(Boolean).join(" "),
        address1,
        address2,
        [city, region, postal].filter(Boolean).join(", ").replace(/, ([^,]+)$/, " $1"),
        country,
        contact.email,
        contact.phone,
      ].filter(Boolean).map(line=>esc(line)).join("<br>");
      const rows = lines.map(item => `<tr>
        <td style="padding:10px 8px;border:1px solid #d4d4d8;text-align:center;">${esc(item.quantity || 1)}</td>
        <td style="padding:10px 8px;border:1px solid #d4d4d8;">${esc(item.description || "")}</td>
        <td style="padding:10px 8px;border:1px solid #d4d4d8;text-align:right;">${esc(money(item.unitPrice, currency))}</td>
        <td style="padding:10px 8px;border:1px solid #d4d4d8;text-align:right;">${esc(money(item.total, currency))}</td>
      </tr>`).join("");
      subject = `${brand} Estimate ${estimateNumber} — ${quote.serviceName || productName}`;
      html = shell(env, "Preliminary custom-project estimate", `
        ${quote.demoSample ? `<div style="margin:0 0 20px;padding:12px 16px;background:#fff3cd;border:1px solid #e8c45c;border-radius:6px;font-weight:700;">DEMO SAMPLE ESTIMATE — subject to technical review and final approval.</div>` : ""}
        <table width="100%" cellpadding="8" cellspacing="0" style="margin:0 0 24px;border-collapse:collapse;">
          <tr style="background:#f4f4f5;"><th style="border:1px solid #d4d4d8;">Estimate #</th><th style="border:1px solid #d4d4d8;">Subject</th><th style="border:1px solid #d4d4d8;">Created</th><th style="border:1px solid #d4d4d8;">Valid until</th></tr>
          <tr><td style="border:1px solid #d4d4d8;text-align:center;">${esc(estimateNumber)}</td><td style="border:1px solid #d4d4d8;">${esc(quote.subject || quote.serviceName || productName)}</td><td style="border:1px solid #d4d4d8;text-align:center;">${esc(quoteDate(created))}</td><td style="border:1px solid #d4d4d8;text-align:center;">${esc(quoteDate(validUntil))}</td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr>
          <td width="50%" valign="top"><strong>Recipient</strong><br><div style="margin-top:8px;line-height:1.5;">${recipientLines}</div></td>
          <td width="50%" valign="top"><strong>Project</strong><br><div style="margin-top:8px;line-height:1.5;">${esc(quote.facilityName || contact.location || "Shipping / installation location pending")}<br>${esc(quote.serviceName || productName)}</div></td>
        </tr></table>
        ${requirements ? `<div style="margin:0 0 24px;padding:16px;background:#f2f8fc;border-left:4px solid ${esc(accent)};"><strong>Requirements discussed</strong><div style="margin-top:8px;line-height:1.5;">${esc(requirements)}</div></div>` : ""}
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr style="background:#f4f4f5;"><th style="padding:10px 8px;border:1px solid #d4d4d8;">Qty</th><th style="padding:10px 8px;border:1px solid #d4d4d8;text-align:left;">Description</th><th style="padding:10px 8px;border:1px solid #d4d4d8;text-align:right;">Unit price</th><th style="padding:10px 8px;border:1px solid #d4d4d8;text-align:right;">Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td colspan="3" style="padding:10px 8px;border:1px solid #d4d4d8;text-align:right;font-weight:700;">Subtotal</td><td style="padding:10px 8px;border:1px solid #d4d4d8;text-align:right;font-weight:700;">${esc(money(quote.monthlyTotal, currency))}</td></tr>
            <tr><td colspan="3" style="padding:12px 8px;border:1px solid #d4d4d8;text-align:right;font-weight:800;">Preliminary project total</td><td style="padding:12px 8px;border:1px solid #d4d4d8;text-align:right;font-weight:800;color:${esc(accent)};">${esc(money(quote.monthlyTotal, currency))}</td></tr>
          </tfoot>
        </table>
        <table width="100%" cellpadding="8" cellspacing="0" style="margin-top:22px;border-collapse:collapse;">
          <tr><td style="border:1px solid #d4d4d8;"><strong>Compatibility</strong></td><td style="border:1px solid #d4d4d8;">Pending cart make, model, year, wiring, and configuration review</td></tr>
          <tr><td style="border:1px solid #d4d4d8;"><strong>Pricing note</strong></td><td style="border:1px solid #d4d4d8;">${esc(quote.promotion || "Final price may change with options, shipping, tax, and installation")}</td></tr>
          <tr><td style="border:1px solid #d4d4d8;"><strong>Credit-card fee</strong></td><td style="border:1px solid #d4d4d8;">${esc(quote.creditCardFeePercent || 3.5)}%</td></tr>
        </table>
        <p style="margin-top:22px;font-size:13px;color:#666;line-height:1.5;">Everything Built Custom products are built to order. This estimate is based on the information available during the call and remains subject to cart compatibility, selected options, final configuration, shipping, taxes, and installation requirements.</p>
        ${estimateCallbackBlock}
        <p style="margin-bottom:0;">Reply to this email or speak with an Everything Built Custom specialist to confirm the cart configuration and receive a final project quote.</p>`);
    } else if (messageType === "buddy-docusign") {
      subject = `Your ${brand} agreement is ready to sign`;
      html = shell(env, "Your agreement is ready", `
        <h2 style="margin-top:0;color:${esc(accent)};">Hi ${esc(contact.firstName || "there")},</h2>
        <p>Your <strong>${esc(productName)}</strong> project agreement is ready for review and signature.</p>
        <div style="margin:28px 0;text-align:center;"><a href="${esc(signingUrl)}" style="display:inline-block;background:${esc(accent)};color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:6px;">Review &amp; Sign Agreement</a></div>
        <p>Once the agreement is signed, ${esc(assistant)} will confirm it and help schedule the build, installation, shipping, or remote-assist next step.</p>`);
    } else if (messageType === "buddy-docusign-signed") {
      subject = `${brand} agreement signed - next up: your project`;
      html = shell(env, "Agreement signed", `
        <h2 style="margin-top:0;color:${esc(accent)};">You're all set, ${esc(contact.firstName || "there")}.</h2>
        <p>We received your signed agreement${productName ? ` for the <strong>${esc(productName)}</strong>` : ""}.</p>
        <p>${esc(assistant)} can now help you choose a build or installation consultation date and time.</p>`);
    } else if (messageType === "ebc-sales-appointment-approve" || messageType === "ebc-sales-appointment-reschedule") {
      const rescheduled = messageType.endsWith("reschedule");
      subject = `Your ${brand} sales consultation is ${rescheduled ? "rescheduled" : "confirmed"}`;
      html = shell(env, rescheduled ? "Sales consultation rescheduled" : "Sales consultation confirmed", `
        <h2 style="margin-top:0;color:${esc(accent)};">${rescheduled ? "Your new time is set" : "Your consultation is confirmed"}, ${esc(contact.firstName || "there")}.</h2>
        <p>An ${esc(brand)} project specialist will be ready to discuss <strong>${esc(contact.selectedProduct || contact.interest || "your custom cart project")}</strong>.</p>
        <div style="margin:24px 0;padding:20px;background:#f2f8fc;border:1px solid #f1caca;border-radius:8px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:${esc(accent)};">${esc(appointment.label || appointment.start || "Confirmed")}</div>
          ${appointment.notes ? `<div style="margin-top:8px;color:#555;">${esc(appointment.notes)}</div>` : ""}
        </div>
        <p>Reply to this email if anything changes. You can also reconnect with ${esc(assistant)} at any time by replying CALL to the latest text or using the call link in your welcome email.</p>`);
    } else if (messageType === "buddy-delivery-confirmed") {
      subject = `Your ${brand} project consultation is scheduled`;
      html = shell(env, "Project consultation scheduled", `
        <h2 style="margin-top:0;color:${esc(accent)};">Consultation confirmed, ${esc(contact.firstName || "there")}.</h2>
        <p>Your <strong>${esc(productName)}</strong> build or installation consultation is scheduled for:</p>
        <div style="margin:24px 0;padding:20px;background:#f5f8ff;border:1px solid #cfdcf5;border-radius:8px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:${esc(accent)};">${esc(delivery.label || delivery.start || contact.deliveryAt || "Scheduled")}</div>
          ${contact.location ? `<div style="margin-top:8px;color:#555;">${esc(contact.location)}</div>` : ""}
        </div>
        <p>${esc(assistant)} has added this consultation to the scheduling calendar. If anything changes, a team member can update the appointment from the operations dashboard.</p>`);
    } else {
      const callNowBlock = callNowUrl ? `
        <div style="margin:30px 0;padding:24px;background:#f5f8ff;border:1px solid #cfdcf5;border-radius:8px;text-align:center;">
          <h3 style="margin:0 0 10px;color:${esc(accent)};">Want to talk now?</h3>
          <p style="margin:0 0 18px;line-height:1.5;">${esc(assistant)} is available 24/7. Click below and the AI assistant will call the phone number on your request right away.</p>
          <a href="${esc(callNowUrl)}" style="display:inline-block;background:${esc(accent)};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:6px;">Have ${esc(assistant)} Call Me Now</a>
          <p style="margin:14px 0 0;font-size:12px;color:#666;">This link stays available in this email whenever you want to reconnect.</p>
        </div>` : "";
      subject = `${brand} - We've Received Your Request`;
      html = shell(env, "Thank you for contacting us", `
        <h2 style="margin-top:0;color:${esc(accent)};">Hi ${esc(contact.firstName || "")},</h2>
        <p>Thank you for contacting <strong>${esc(brand)}</strong>. We've received your request and ${esc(assistant)} is ready to help.</p>
        ${callNowBlock}
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:28px 0;">
        <h3 style="color:${esc(accent)};">Your Request</h3>
        <table width="100%" cellpadding="8" cellspacing="0">
        <tr><td width="35%"><strong>Name</strong></td><td>${esc(contact.firstName || "")} ${esc(contact.lastName || "")}</td></tr>
        <tr><td><strong>Email</strong></td><td>${esc(contact.email || "")}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${esc(contact.phone || "")}</td></tr>
        <tr><td><strong>Interested In</strong></td><td>${esc(lead.product_interest || lead.product_interestedIn || contact.interest || "")}</td></tr>
        <tr><td><strong>State / Area</strong></td><td>${esc(lead.preferred_store || contact.location || "")}</td></tr>
        <tr><td><strong>Preferred Contact</strong></td><td>${esc(lead.contact_method || contact.preferredContactMethod || "")}</td></tr>
        </table>`);
    }

    const response = await fetch(RESEND_URL, {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.RESEND_API_KEY}`, "Content-Type":"application/json" },
      body:JSON.stringify({ from:env.FROM_EMAIL, to:[contact.email], subject, html }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await emit(env, { type:"email.failed", contactId, messageType, provider:"resend", to:contact.email || "", subject, error:data?.message || data?.error || `Resend failed (${response.status})` });
      return Response.json({ ok:false, provider:"resend", status:response.status, error:data }, { status:500 });
    }

    await emit(env, { type:"email.sent", contactId, messageType, provider:"resend", messageId:data.id || "", to:contact.email || "", subject, productName, deliveryAt:delivery.start || contact.deliveryAt || "", appointmentAt:appointment.start || "" });
    return Response.json({ ok:true, provider:"resend", messageId:data.id, messageType, callNowIncluded:Boolean(callNowUrl), signingLinkIncluded:Boolean(signingUrl), deliveryIncluded:messageType === "buddy-delivery-confirmed", appointmentIncluded:messageType.startsWith("ebc-sales-appointment-") });
  }
};
