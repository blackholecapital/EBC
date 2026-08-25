import { createBuddySigningSession, docusignConfigured } from "./docusign.js";
import { createSigningShortLink, resolveSigningShortLink } from "./docusign-links.js";
import { fetchSignedEnvelopePdf } from "./docusign-document.js";
import { rememberSmsContact, getSmsContact, getSmsContactById } from "./sms-session.js";
import { createDeliveryEvent, googleCalendarConfigured, googleCalendarTimeZone, isSlotAvailable } from "./google-calendar.js";
import { isEbcCallbackReply } from "./sms-reply.js";
import { nextAppointmentRequest } from "./appointment-request.js";
import { hydrateSharedSecrets } from "../../shared/cloudflare-secrets.mjs";

const SHARED_SECRET_MAPPINGS = [
  { target:"GOOGLE_CLIENT_ID", binding:"SHARED_GOOGLE_CLIENT_ID" },
  { target:"GOOGLE_CLIENT_SECRET", binding:"SHARED_GOOGLE_CLIENT_SECRET" },
  { target:"GOOGLE_REFRESH_TOKEN", binding:"SHARED_GOOGLE_REFRESH_TOKEN" },
  { target:"DOCUSIGN_ACCOUNT_ID", binding:"SHARED_DOCUSIGN_ACCOUNT_ID" },
  { target:"DOCUSIGN_INTEGRATION_KEY", binding:"SHARED_DOCUSIGN_INTEGRATION_KEY" },
  { target:"DOCUSIGN_USER_ID", binding:"SHARED_DOCUSIGN_USER_ID" },
];

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return new Uint8Array(digest);
}
async function secretsEqual(a,b) {
  const left=await sha256(a), right=await sha256(b); let diff=left.length^right.length;
  for(let i=0;i<Math.max(left.length,right.length);i++) diff|=(left[i]??0)^(right[i]??0);
  return diff===0;
}
async function authorizeInternal(request,env) {
  const configured=env.INTERNAL_CALL_SECRET||"", provided=request.headers.get("x-internal-call-secret")||"";
  if(!configured) return {ok:false,response:Response.json({ok:false,error:"Internal service authentication is not configured"},{status:503})};
  if(!provided||!(await secretsEqual(provided,configured))) return {ok:false,response:Response.json({ok:false,error:"Unauthorized"},{status:401})};
  return {ok:true};
}
function preferredMethod(payload={}) { return String(payload.contact?.preferredContactMethod||payload.lead?.contact_method||payload.lead?.preferredContactMethod||"").trim(); }
function smsConsentGranted(payload={}) { const v=payload.contact?.smsConsent??payload.lead?.consent; return v===true||v==="true"||v==="on"; }
function normalizePhone(v="") { return String(v||"").replace(/\D/g,"").replace(/^1(?=\d{10}$)/,""); }
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function brandName(env){return String(env.BRAND_NAME||"Everything Built Custom");}
function assistantName(env){return String(env.ASSISTANT_NAME||"AI Concierge");}
function tenantContext(env,event={}){const payload=event.payload||{};const contact=payload.contact||event.contact||{};return{tenantId:String(event.tenantId||payload.tenantId||env.TENANT_ID||"blackhole"),corporateId:String(event.corporateId||payload.corporateId||env.CORPORATE_ID||env.TENANT_ID||"blackhole"),locationId:String(event.locationId||payload.locationId||payload.location_id||contact.locationId||contact.location_id||env.DEFAULT_LOCATION_ID||"corporate")};}
function base64Url(bytes){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
async function buildCallNowUrl(env,contactId){
  if(!env.INTERNAL_CALL_SECRET||!contactId)return"";
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(env.INTERNAL_CALL_SECRET)),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`buddy-call:${contactId}`));
  const base=String(env.DASHBOARD_URL||"").replace(/\/$/,"");
  return base?`${base}/api/call-now?id=${encodeURIComponent(contactId)}&sig=${encodeURIComponent(base64Url(new Uint8Array(signature)))}`:"";
}

async function callBinding(binding,url,payload){
  if(!binding) return {ok:false,skipped:true,reason:"Binding not configured"};
  try{
    const response=await binding.fetch(new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));
    const text=await response.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    return response.ok?data:{ok:false,status:response.status,...data};
  }catch(e){return {ok:false,error:e.message};}
}
async function emit(env,event){
  const tenant=tenantContext(env,event),tagged={...event,...tenant,ts:Date.now()};
  if(env.EVENTS&&!String(event.type||"").startsWith("buddy.product.selected")){try{await env.EVENTS.send(tagged);}catch{}}
  if(env.ANALYTICS){try{env.ANALYTICS.writeDataPoint({blobs:[event.type||"concierge.event",event.contactId||"",event.envelopeId||"",tenant.tenantId,tenant.corporateId,tenant.locationId],doubles:[Date.now()],indexes:[tenant.tenantId]});}catch{}}
}
async function listDashboardContacts(env){
  const base=String(env.DASHBOARD_URL||"").replace(/\/$/,""); if(!base)return[];
  const response=await fetch(`${base}/api/contacts`); if(!response.ok)return[];
  const body=await response.json().catch(()=>({})); const rows=Array.isArray(body)?body:body?.data||body?.contacts||body?.rows||[];
  return Array.isArray(rows)?rows:[];
}
async function getDashboardContact(env,id){const rows=await listDashboardContacts(env);return rows.find(c=>c?.id===id)||null;}
async function getDashboardContactByPhone(env,phone){const target=normalizePhone(phone);if(!target)return null;const rows=await listDashboardContacts(env);return [...rows].reverse().find(c=>normalizePhone(c?.phone)===target)||null;}
async function updateDashboardContact(env,id,patch){
  if(!id)return null;const base=String(env.DASHBOARD_URL||"").replace(/\/$/,"");if(!base)return null;
  const response=await fetch(`${base}/api/contacts/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});
  return response.ok?await response.json().catch(()=>null):null;
}
function mergeContact(base={},payload={}){return{...base,id:payload.contactId||base.id||"",firstName:base.firstName||payload.firstName||"",lastName:base.lastName||payload.lastName||"",company:base.company||payload.company||payload.companyName||"",phone:base.phone||payload.phone||"",email:base.email||payload.email||"",addressLine1:base.addressLine1||payload.addressLine1||payload.address1||"",addressLine2:base.addressLine2||payload.addressLine2||payload.address2||"",city:base.city||payload.city||"",state:base.state||payload.state||payload.region||"",postalCode:base.postalCode||payload.postalCode||payload.zip||"",country:base.country||payload.country||"",location:base.location||payload.location||"",interest:base.interest||payload.category||payload.interest||"",comments:base.comments||payload.comments||"",leadScore:base.leadScore??payload.leadScore??"",smsConsent:base.smsConsent??payload.smsConsent??true};}
async function resolveContact(env,id,payload={}){
  const persisted=id?await getSmsContactById(env,id).catch(()=>null):null;
  const dashboard=id?await getDashboardContact(env,id).catch(()=>null):null;
  return mergeContact(persisted||dashboard||payload.contact||{},payload);
}
async function persistContact(env,contact,patch={}){
  const next={...contact,...patch};try{await rememberSmsContact(env,next);}catch{}
  return next;
}

async function recentConversation(env,contactId,limit=16){
  if(!env.DB||!contactId)return[];
  try{
    const result=await env.DB.prepare(`
      SELECT role, text, event_type, call_sid, created_at
      FROM buddy_communication_events
      WHERE contact_id = ?
        AND text IS NOT NULL
        AND text <> ''
        AND role IN ('customer', 'buddy')
      ORDER BY created_at DESC
      LIMIT 80
    `).bind(String(contactId)).all();
    const rows=[...(result.results||[])].reverse();
    const turns=[];
    for(const row of rows){
      const type=String(row.event_type||"");
      if(row.role==="buddy"&&(type==="buddy.sales.discovery"||type==="buddy.turn.completed"||type==="buddy.sales.followup-requested"))continue;
      const turn={role:row.role==="buddy"?"assistant":"user",content:String(row.text||"").trim(),at:Number(row.created_at||0),callSid:String(row.call_sid||"")};
      if(!turn.content)continue;
      const prior=turns[turns.length-1];
      if(prior&&prior.role===turn.role&&prior.content===turn.content)continue;
      turns.push(turn);
    }
    return turns.slice(-Math.min(Math.max(Number(limit)||16,1),24));
  }catch(error){
    console.warn("Conversation context lookup unavailable",{contactId,error:error?.message||String(error)});
    return[];
  }
}

function zonedParts(date,timeZone){const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);const out={};for(const p of parts)if(p.type!=="literal")out[p.type]=p.value;return{year:+out.year,month:+out.month,day:+out.day,hour:+out.hour,minute:+out.minute,second:+out.second};}
function timezoneOffsetMinutes(date,tz){const p=zonedParts(date,tz);return Math.round((Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-date.getTime())/60000);}
function localDateTimeToIso({year,month,day,hour,minute=0},tz){const guess=Date.UTC(year,month-1,day,hour,minute,0);let date=new Date(guess);const first=timezoneOffsetMinutes(date,tz);date=new Date(guess-first*60000);const second=timezoneOffsetMinutes(date,tz);if(second!==first)date=new Date(guess-second*60000);return date.toISOString();}
function addLocalDays(parts,days){const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days,12));return{year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};}
function formatDeliverySlot(startIso,tz){return new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"long",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(startIso));}
async function buildDeliveryOptions(env,now=new Date()){
  if(!googleCalendarConfigured(env))throw new Error("Google Calendar is not configured");
  const timeZone=googleCalendarTimeZone(env), localNow=zonedParts(now,timeZone), today={year:localNow.year,month:localNow.month,day:localNow.day};
  const specs=[],options=[];
  for(let days=0;days<14;days+=1){for(const hour of [11,14,19])specs.push({days,hour});}
  for(const spec of specs){const localDate=addLocalDays(today,spec.days);const startIso=localDateTimeToIso({...localDate,hour:spec.hour},timeZone);const endIso=new Date(new Date(startIso).getTime()+7200000).toISOString();if(new Date(startIso).getTime()<now.getTime()+1800000)continue;let available=false;try{available=await isSlotAvailable(env,startIso,endIso);}catch(e){throw new Error(`Google Calendar availability check failed: ${e.message}`);}if(!available)continue;options.push({startIso,endIso,label:formatDeliverySlot(startIso,timeZone),timeZone});if(options.length>=3)break;}
  return{timeZone,now:now.toISOString(),options};
}

async function requestBuddyCall(env,contact,trigger={}){
  if(!env.VOICE)return{ok:false,error:"VOICE binding not configured"};
  const payload={contactId:contact.id||trigger.contactId||"",contact,context:{firstName:contact.firstName,lastName:contact.lastName,phone:contact.phone,email:contact.email,interest:contact.interest,location:contact.location,comments:contact.comments,leadScore:contact.leadScore,preferredContactTime:contact.preferredContactTime,source:contact.source},trigger};
  const response=await env.VOICE.fetch(new Request("https://voice.internal/internal/calls",{method:"POST",headers:{"Content-Type":"application/json","x-internal-call-secret":env.INTERNAL_CALL_SECRET},body:JSON.stringify(payload)}));
  const text=await response.text();let result={};try{result=text?JSON.parse(text):{};}catch{result={raw:text};}if(!response.ok)throw new Error(result?.error||`Voice call failed (${response.status})`);
  await persistContact(env,contact,{stage:"Contacted",callStatus:"Call requested"});
  await updateDashboardContact(env,contact.id,{stage:"Contacted",callStatus:"Call requested"});
  await emit(env,{type:"call.requested",contactId:contact.id||"",payload});return result;
}

async function processProductSelection(env,payload={}){
  const contactId=payload.contactId||payload.contact?.id||"",contact=await resolveContact(env,contactId,payload);
  const product={id:payload.productId||payload.product?.id||"",name:payload.productName||payload.product?.name||"",category:payload.category||contact.interest||""};const selectionNumber=Number(payload.selectionNumber||1);
  if(!contact.phone)throw new Error("Selected lead has no phone number");if(!contact.email)throw new Error("Selected lead has no email address for DocuSign signer identity");
  const docusign=await createBuddySigningSession(env,{contact,product,selectionNumber,contactId});
  const shortSigningUrl=await createSigningShortLink(env,{targetUrl:docusign.signingUrl,contactId,envelopeId:docusign.envelopeId});
  let sms={ok:false,skipped:true,reason:"SMS consent not granted"};
  if(contact.smsConsent!==false)sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact,messageType:"buddy-docusign",message:`Great choice${contact.firstName?`, ${contact.firstName}`:""}. Your ${brandName(env)} agreement for the ${product.name} is ready. Sign here: ${shortSigningUrl} Reply STOP to opt out.`,docusign:{...docusign,shortSigningUrl},product});
  const email=contact.email?await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact,messageType:"buddy-docusign",docusign:{...docusign,shortSigningUrl},product}):{ok:false,skipped:true};
  await persistContact(env,contact,{stage:"Docs Sent",callStatus:"In progress",selectedProduct:product.name,selectedProductId:product.id,selectionNumber,docusignEnvelopeId:docusign.envelopeId,agreementId:docusign.agreementId,documentStatus:"Sent",signingShortUrl:shortSigningUrl});
  await updateDashboardContact(env,contactId,{stage:"Docs Sent",documentStatus:"Sent",selectedProduct:product.name,selectedProductId:product.id,selectionNumber,docusignEnvelopeId:docusign.envelopeId,agreementId:docusign.agreementId});
  await emit(env,{type:"docusign.sent",contactId,envelopeId:docusign.envelopeId,agreementId:docusign.agreementId,productName:product.name,selectionNumber});
  return{ok:true,contactId,product,docusign:{...docusign,shortSigningUrl},sms,email};
}


function estimateNumberFor(contactId=""){
  const day=new Date().toISOString().slice(0,10).replaceAll("-","");
  const suffix=String(contactId||crypto.randomUUID()).replace(/[^A-Za-z0-9]/g,"").slice(-8).toUpperCase();
  return `EBC-${day}-${suffix}`;
}
async function processPreliminaryEstimate(env,payload={}){
  const contactId=payload.contactId||payload.contact?.id||"";
  const contact=await resolveContact(env,contactId,payload);
  if(!contact.email)throw new Error("Selected lead has no email address for estimate delivery");
  const createdAt=new Date().toISOString();
  const validityDays=Math.max(1,Number(payload.quote?.validityDays||30));
  const validUntil=new Date(Date.now()+validityDays*86400000).toISOString();
  const quote={...(payload.quote||{}),estimateNumber:payload.quote?.estimateNumber||estimateNumberFor(contactId),createdAt,validUntil,validityDays};
  const requirements=Array.isArray(payload.requirements)?payload.requirements.join(" "):String(payload.requirements||"");
  const callNowUrl=await buildCallNowUrl(env,contactId);
  const email=await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact,messageType:"ebc-preliminary-estimate",quote,requirements,callback:{callNowUrl,persistent:true,source:"estimate-email"}});
  if(email?.ok!==true)throw new Error(email?.error||`Estimate email failed (${email?.status||"unknown"})`);
  const patch={stage:"Estimate Sent",callStatus:"Estimate emailed",estimateStatus:"Sent",estimateNumber:quote.estimateNumber,estimateSentAt:createdAt,estimateValidUntil:validUntil,estimatedMonthlyTotal:quote.monthlyTotal||0,estimateQuote:quote,requirementsSummary:requirements,selectedProduct:quote.serviceName||contact.selectedProduct||contact.interest||"",salesHandoffStatus:"Estimate sent"};
  await persistContact(env,contact,patch);
  await updateDashboardContact(env,contactId,patch);
  await emit(env,{type:"estimate.sent",contactId,estimateNumber:quote.estimateNumber,message:`Estimate ${quote.estimateNumber} emailed to ${contact.email}`,messageId:email.messageId||"",productName:quote.serviceName||"",monthlyTotal:Number(quote.monthlyTotal||0),requirements});
  return{ok:true,contactId,quote,email};
}

async function processProductInterest(env,payload={}){
  const contactId=String(payload.contactId||payload.contact?.id||"");
  const contact=await resolveContact(env,contactId,payload);
  if(!contactId||!contact?.id)throw new Error("Product interest requires a valid contact");
  const productName=String(payload.productName||payload.product?.name||"").trim();
  if(!productName)throw new Error("Product interest requires a product name");
  const requirements=String(payload.requirements||"").trim();
  const patch={stage:"Engaged",selectedProduct:productName,requirementsSummary:requirements||contact.requirementsSummary||"",callStatus:"Consultation in progress"};
  await persistContact(env,contact,patch);
  await updateDashboardContact(env,contactId,patch);
  await emit(env,{type:"product.interest.selected",contactId,productName,requirements,callSid:String(payload.callSid||""),message:`${productName} recorded as the current recommendation`});
  return{ok:true,contactId,productName};
}

async function processSalesHandoff(env,payload={}){
  const contactId=payload.contactId||payload.contact?.id||"";
  const contact=await resolveContact(env,contactId,payload);
  if(!contactId||!contact?.id)throw new Error("Sales handoff requires a valid contact");
  const createdAt=new Date().toISOString();
  const requirements=Array.isArray(payload.requirements)?payload.requirements.join(" "):String(payload.requirements||"").trim();
  const reason=String(payload.reason||"Customer requested sales follow-up").trim();
  const patch={stage:"Engaged",callStatus:"Needs sales follow-up",salesHandoffStatus:"Open",salesHandoffAt:createdAt,salesHandoffReason:reason,requirementsSummary:requirements,lastCallSid:String(payload.callSid||"")};
  await persistContact(env,contact,patch);
  await updateDashboardContact(env,contactId,patch);
  await emit(env,{type:"sales.handoff.created",contactId,callSid:String(payload.callSid||""),message:`Sales handoff created: ${reason}`,reason,requirements,source:String(payload.source||"ebc-voice-worker")});
  return{ok:true,contactId,handoff:{status:"Open",createdAt,reason,requirements}};
}

async function processManualMessage(env,payload={}){
  const contactId=String(payload.contactId||payload.contact?.id||"");
  const contact=await resolveContact(env,contactId,payload);
  const channel=String(payload.channel||"sms").toLowerCase();
  const message=String(payload.message||payload.body||"").trim();
  if(channel!=="sms")throw new Error("Only SMS is supported for manual dashboard messages");
  if(!contactId||!contact?.id)throw new Error("A valid contact is required");
  if(!contact.phone)throw new Error("The contact has no phone number");
  if(contact.optedOut||contact.smsConsent===false)throw new Error("The contact has opted out of SMS");
  if(!message)throw new Error("SMS message is required");
  const sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{
    contactId,contact,message,
    messageType:String(payload.messageType||"ebc-dashboard-manual"),
  });
  if(!sms?.ok)throw new Error(sms?.error||"Twilio did not accept the SMS");
  await updateDashboardContact(env,contactId,{outreachStatus:"SMS sent",lastSmsSentAt:new Date().toISOString()});
  return{ok:true,contactId,sms};
}

function formatSalesAppointment(startIso,timeZone="America/New_York"){
  if(!startIso)return"Time requested; awaiting sales-team confirmation";
  return new Intl.DateTimeFormat("en-US",{timeZone,weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(startIso));
}
async function processSalesAppointment(env,payload={}){
  const contactId=String(payload.contactId||payload.contact?.id||"");
  const contact=await resolveContact(env,contactId,payload);
  if(!contactId||!contact?.id)throw new Error("Sales appointment requires a valid contact");
  const action=String(payload.action||"request").toLowerCase();
  if(!["request","approve","reschedule"].includes(action))throw new Error("Unsupported sales appointment action");
  const timeZone=String(payload.timeZone||contact.appointmentTimeZone||"America/New_York");
  const candidate=String(payload.startIso||payload.start||(action==="request"?"":contact.appointmentStart)||"");
  if(action!=="request"&&(!candidate||Number.isNaN(new Date(candidate).getTime())))throw new Error("A valid appointment date and time is required");
  const startIso=candidate&&!Number.isNaN(new Date(candidate).getTime())?new Date(candidate).toISOString():"";
  const durationMinutes=Math.max(15,Math.min(240,Number(payload.durationMinutes||30)));
  const endIso=startIso?new Date(new Date(startIso).getTime()+durationMinutes*60000).toISOString():"";
  const now=new Date().toISOString();
  const status=action==="request"?"Requested":action==="approve"?"Approved":"Rescheduled";
  const label=formatSalesAppointment(startIso,timeZone);
  const requestState=action==="request"
    ?nextAppointmentRequest(contact,{start:startIso||null,end:endIso||null,timeZone,label,notes:String(payload.notes||payload.requirements||"").trim(),requestedAt:now,source:String(payload.source||"ebc-workflow")})
    :{requestId:String(contact.appointmentRequestId||""),requestCount:Number(contact.appointmentRequestCount||0),requestedAt:String(contact.appointmentRequestedAt||now),appointmentHistory:Array.isArray(contact.appointmentHistory)?contact.appointmentHistory:[]};
  const {requestId,requestCount,requestedAt,appointmentHistory}=requestState;
  const patch={
    appointmentStatus:status,appointmentStart:startIso||null,appointmentEnd:endIso||null,appointmentTimeZone:timeZone,
    appointmentNotes:String(payload.notes||contact.appointmentNotes||payload.requirements||"").trim(),
    appointmentRequestId:requestId,appointmentRequestCount:requestCount,appointmentHistory,
    appointmentRequestedAt:requestedAt,appointmentUpdatedAt:now,
    appointmentNotificationStatus:action==="request"?"Awaiting sales approval":"Sending",
  };
  let saved=await persistContact(env,contact,patch);
  await updateDashboardContact(env,contactId,patch);

  let sms={ok:false,skipped:true},email={ok:false,skipped:true};
  if(action!=="request"){
    const verb=action==="reschedule"?"rescheduled":"confirmed";
    if(saved.smsConsent!==false&&saved.phone)sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact:saved,messageType:`ebc-sales-appointment-${action}`,message:`Hi${saved.firstName?` ${saved.firstName}`:""}, your ${brandName(env)} sales consultation is ${verb} for ${label}. Reply EBC any time to reconnect with ${assistantName(env)}. Reply STOP to opt out.`});
    if(saved.email)email=await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact:saved,messageType:`ebc-sales-appointment-${action}`,appointment:{status,start:startIso,end:endIso,timeZone,label,notes:patch.appointmentNotes}});
    const notified=[sms,email].some(result=>result?.ok===true);
    const attempted=[sms,email].some(result=>result?.skipped!==true);
    const notificationPatch={appointmentNotificationStatus:notified?"Sent":attempted?"Failed":"No contact channel",appointmentNotifiedAt:notified?new Date().toISOString():null};
    saved=await persistContact(env,saved,notificationPatch);
    await updateDashboardContact(env,contactId,notificationPatch);
  }

  const eventType={request:"sales.appointment.requested",approve:"sales.appointment.approved",reschedule:"sales.appointment.rescheduled"}[action];
  await emit(env,{type:eventType,contactId,appointmentRequestId:requestId,appointmentRequestCount:requestCount,appointmentStatus:status,appointmentStart:startIso,appointmentEnd:endIso,timeZone,label,notes:patch.appointmentNotes,smsOk:sms?.ok===true,emailOk:email?.ok===true,source:String(payload.source||"ebc-workflow")});
  return{ok:true,contactId,appointment:{requestId,requestCount,status,start:startIso,end:endIso,timeZone,label,notes:patch.appointmentNotes,notificationStatus:saved.appointmentNotificationStatus},sms,email};
}

async function scheduleDelivery(env,payload={}){
  const contactId=payload.contactId||"",contact=await resolveContact(env,contactId,payload);if(!contactId||!contact?.id)throw new Error("Project scheduling requires a valid contact");if(String(contact.documentStatus||"").toLowerCase()!=="signed")throw new Error("Agreement must be signed before build or installation scheduling");if(!googleCalendarConfigured(env))throw new Error("Google Calendar is not configured");
  const startIso=String(payload.startIso||payload.start||"");if(!startIso||Number.isNaN(new Date(startIso).getTime()))throw new Error("A valid project consultation start time is required");const durationMinutes=Math.max(30,Number(payload.durationMinutes||120));const endIso=String(payload.endIso||new Date(new Date(startIso).getTime()+durationMinutes*60000).toISOString());if(!(await isSlotAvailable(env,startIso,endIso)))return{ok:false,conflict:true,error:"That project consultation slot is no longer available"};
  const product={name:contact.selectedProduct||contact.interest||`${brandName(env)} service`};const calendar=await createDeliveryEvent(env,{contact,product,startIso,endIso,timeZone:payload.timeZone||googleCalendarTimeZone(env),contactId});const timeZone=calendar.timeZone||googleCalendarTimeZone(env),deliveryLabel=formatDeliverySlot(calendar.start,timeZone);
  const scheduled=await persistContact(env,contact,{stage:"Scheduled",callStatus:"Call completed",deliveryAt:calendar.start,deliveryEnd:calendar.end,deliveryStatus:"Scheduled",calendarEventId:calendar.id,calendarEventUrl:calendar.htmlLink});
  await updateDashboardContact(env,contactId,{stage:"Scheduled",callStatus:"Call completed",deliveryAt:calendar.start,deliveryEnd:calendar.end,deliveryStatus:"Scheduled",calendarEventId:calendar.id,calendarEventUrl:calendar.htmlLink});
  let sms={ok:false,skipped:true};if(scheduled.smsConsent!==false&&scheduled.phone)sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact:scheduled,messageType:"buddy-delivery-confirmed",message:`You're scheduled${scheduled.firstName?`, ${scheduled.firstName}`:""}. Your ${brandName(env)} project consultation for ${product.name} is set for ${deliveryLabel}. Reply STOP to opt out.`,delivery:{...calendar,label:deliveryLabel},product});
  const email=scheduled.email?await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact:scheduled,messageType:"buddy-delivery-confirmed",delivery:{...calendar,label:deliveryLabel},product}):{ok:false,skipped:true};
  await emit(env,{type:"delivery.scheduled",contactId,calendarEventId:calendar.id,deliveryAt:calendar.start,productName:product.name});return{ok:true,contactId,delivery:{...calendar,label:deliveryLabel},sms,email};
}

export default { async fetch(request,env,ctx){
  env=await hydrateSharedSecrets(env,SHARED_SECRET_MAPPINGS);
  const url=new URL(request.url);
  if(url.pathname==="/api/health")return Response.json({ok:true,service:env.TENANT_ID==="ebc"?"ebc-concierge-worker":"blackhole-concierge-worker",health:"online",runtime:"edge",tenant:tenantContext(env),docusign:docusignConfigured(env)?"configured":"not-configured",googleCalendar:googleCalendarConfigured(env)?"configured":"not-configured",googleCalendarTimeZone:googleCalendarTimeZone(env)});
  if(url.pathname==="/docusign/consent-complete")return new Response(`DocuSign consent granted. You can close this tab and return to ${assistantName(env)}.`,{status:200,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  if(url.pathname.startsWith("/docusign/sign/")&&request.method==="GET"){const token=decodeURIComponent(url.pathname.slice("/docusign/sign/".length));const row=await resolveSigningShortLink(env,token).catch(()=>null);if(!row?.target_url)return new Response("This signing link is unavailable.",{status:404});return Response.redirect(String(row.target_url),302);}
  if(url.pathname.startsWith("/docusign/document/")&&request.method==="GET"){
    const contactId=decodeURIComponent(url.pathname.slice("/docusign/document/".length));const contact=await getSmsContactById(env,contactId).catch(()=>null);if(!contact?.docusignEnvelopeId)return new Response("Signed document not found.",{status:404});
    try{const tenant=tenantContext(env,{contact}),key=`tenants/${tenant.tenantId}/documents/${encodeURIComponent(contactId)}/${encodeURIComponent(contact.docusignEnvelopeId)}.pdf`;let pdf;const cached=env.DOCUMENT_ARCHIVE?await env.DOCUMENT_ARCHIVE.get(key):null;if(cached){pdf=await cached.arrayBuffer();}else{pdf=await fetchSignedEnvelopePdf(env,contact.docusignEnvelopeId);if(env.DOCUMENT_ARCHIVE)await env.DOCUMENT_ARCHIVE.put(key,pdf,{httpMetadata:{contentType:"application/pdf"},customMetadata:{tenantId:tenant.tenantId,corporateId:tenant.corporateId,contactId}});}const name=`${brandName(env)}-Agreement-${contact.firstName||"customer"}-${contact.lastName||""}.pdf`.replace(/[^A-Za-z0-9._-]+/g,"-");return new Response(pdf,{status:200,headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename=\"${name}\"`,"Cache-Control":"private, no-store"}});}catch(e){return new Response(e.message||"Unable to load signed document",{status:502});}
  }
  if(url.pathname==="/internal/contact-status"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json().catch(()=>({}));const contact=await getSmsContactById(env,p.contactId||"").catch(()=>null)||await getDashboardContact(env,p.contactId||"").catch(()=>null);if(!contact)return Response.json({ok:false,error:"Contact not found"},{status:404});const conversation=await recentConversation(env,contact.id||p.contactId,Number(p.conversationLimit||16));return Response.json({ok:true,contactId:contact.id||p.contactId,documentStatus:contact.documentStatus||"Not sent",selectedProduct:contact.selectedProduct||"",docusignEnvelopeId:contact.docusignEnvelopeId||"",deliveryStatus:contact.deliveryStatus||"Not scheduled",deliveryAt:contact.deliveryAt||"",calendarEventId:contact.calendarEventId||"",estimateStatus:contact.estimateStatus||"",estimateNumber:contact.estimateNumber||"",estimateSentAt:contact.estimateSentAt||"",requirementsSummary:contact.requirementsSummary||"",salesHandoffStatus:contact.salesHandoffStatus||"",appointmentStatus:contact.appointmentStatus||"",appointmentStart:contact.appointmentStart||"",appointmentTimeZone:contact.appointmentTimeZone||"",recentConversation:conversation});}
  if(url.pathname==="/internal/delivery-options"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{const p=await request.json().catch(()=>({}));const contact=await resolveContact(env,p.contactId||"",p);if(!contact?.id)return Response.json({ok:false,error:"Contact not found"},{status:404});if(String(contact.documentStatus||"").toLowerCase()!=="signed")return Response.json({ok:false,error:"Agreement must be signed before project scheduling"},{status:409});return Response.json({ok:true,contactId:contact.id,selectedProduct:contact.selectedProduct||"",...(await buildDeliveryOptions(env))});}catch(e){return Response.json({ok:false,error:e.message,googleCalendarConfigured:googleCalendarConfigured(env)},{status:502});}}
  if(url.pathname==="/internal/delivery-schedule"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{const result=await scheduleDelivery(env,await request.json().catch(()=>({})));return Response.json(result,{status:result.ok?200:result.conflict?409:400});}catch(e){return Response.json({ok:false,error:e.message,googleCalendarConfigured:googleCalendarConfigured(env)},{status:502});}}
  if(url.pathname==="/internal/leads"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const payload=await request.json(),method=preferredMethod(payload),contact=payload.contact||{},results={};if(contact.phone&&contact.id){try{results.smsSession={ok:await rememberSmsContact(env,contact)};}catch(e){results.smsSession={ok:false,error:e.message};}}results.email=contact.email?await callBinding(env.EMAIL,"https://email.internal/internal/send",payload):{ok:false,skipped:true};if(!smsConsentGranted(payload))results.sms={ok:false,skipped:true,reason:"SMS consent not granted"};else if(contact.phone){const assistant=assistantName(env),brand=brandName(env),message=method==="Phone"?`Hi ${contact.firstName||"there"}, I'm ${assistant}, the ${brand} AI assistant. I received your request${contact.interest?` about ${contact.interest}`:""}. I'll call you in about 15 seconds. If you miss the call or aren't available, reply EBC at any time and I'll call you immediately. Reply STOP to opt out.`:`Hi ${contact.firstName||"there"}, I'm ${assistant}, the ${brand} AI assistant. I received your request${contact.interest?` about ${contact.interest}`:""}. Would you like me to call you? Reply EBC and I'll ring you. Reply STOP to opt out.`;results.sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{...payload,messageType:method==="Phone"?"ebc-precall":"ebc-welcome",message});}else results.sms={ok:false,skipped:true};const contactFlow=method==="Phone"?"sms-then-call":method==="Text"?"sms-awaiting-call-reply":"email";if(method==="Phone"&&contact.phone){const delayed=(async()=>{await sleep(15000);try{await requestBuddyCall(env,contact,{type:"lead-form",preferredContactMethod:"Phone",delaySeconds:15});}catch(e){await updateDashboardContact(env,contact.id,{callStatus:"Call failed"});}})();if(ctx?.waitUntil)ctx.waitUntil(delayed);}await emit(env,{type:"lead.created",contactId:payload.contactId||contact.id||"",payload});return Response.json({ok:true,preferredContactMethod:method,contactFlow,results});}
  if(url.pathname==="/internal/sms-reply"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json(),reply=String(p.body||p.Body||p.message||"").trim(),from=p.from||p.From||p.phone||"",wantsCall=isEbcCallbackReply(reply);let contact=null,source="none";try{contact=await getSmsContact(env,from);if(contact)source="d1-sms-session";}catch{}if(!contact){contact=await getDashboardContactByPhone(env,from);if(contact)source="dashboard-fallback";}console.log("EBC SMS reply matched",{from,reply,wantsCall,matched:Boolean(contact),source,contactId:contact?.id||""});await emit(env,{type:"sms.reply",contactId:contact?.id||"",from,reply,wantsCall,source});if(!wantsCall)return Response.json({ok:true,action:"none",matched:Boolean(contact),source});if(!contact)return Response.json({ok:false,error:"No EBC lead matched the replying phone number"},{status:404});try{return Response.json({ok:true,action:"call",contactId:contact.id,source,call:await requestBuddyCall(env,contact,{type:"sms-reply",reply,source})});}catch(e){await updateDashboardContact(env,contact.id,{callStatus:"Call failed"});return Response.json({ok:false,error:e.message,contactId:contact.id,source},{status:502});}}
  if(url.pathname==="/internal/calls"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json(),contact=p.contact||await getSmsContactById(env,p.contactId||"")||await getDashboardContact(env,p.contactId||"");if(!contact)return Response.json({ok:false,error:"Contact not found"},{status:404});try{return Response.json({ok:true,service:"voice",result:await requestBuddyCall(env,contact,p.trigger||{type:"manual"})});}catch(e){return Response.json({ok:false,service:"voice",error:e.message},{status:502});}}
  if(url.pathname==="/internal/preliminary-estimate"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processPreliminaryEstimate(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/sales-handoff"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processSalesHandoff(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/messages"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processManualMessage(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/sales-appointment"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processSalesAppointment(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/product-interest"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processProductInterest(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/product-selected"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processProductSelection(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message,docusignConfigured:docusignConfigured(env)},{status:502});}}
  if(url.pathname==="/docusign/connect"&&request.method==="POST"){const contentType=request.headers.get("content-type")||"",payload=contentType.includes("json")?await request.json().catch(()=>({})):{raw:await request.text()},contactId=url.searchParams.get("contactId")||"",envelopeId=payload?.data?.envelopeId||payload?.envelopeId||"",status=String(payload?.data?.envelopeSummary?.status||payload?.status||payload?.event||"unknown");if(/completed/i.test(status)){await updateDashboardContact(env,contactId,{stage:"Docs Sent",documentStatus:"Signed",docusignEnvelopeId:envelopeId});const contact=await getSmsContactById(env,contactId).catch(()=>null)||await getDashboardContact(env,contactId).catch(()=>null);if(contact){const signed=await persistContact(env,contact,{stage:"Docs Sent",documentStatus:"Signed",docusignEnvelopeId:envelopeId||contact.docusignEnvelopeId});if(signed.smsConsent!==false&&signed.phone)await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact:signed,messageType:"buddy-docusign-signed",message:`Thanks${signed.firstName?`, ${signed.firstName}`:""}. We received your signed ${brandName(env)} project agreement${signed.selectedProduct?` for ${signed.selectedProduct}`:""}. Next, we'll schedule your build or installation consultation. Reply STOP to opt out.`});if(signed.email)await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact:signed,messageType:"buddy-docusign-signed",productName:signed.selectedProduct||""});}}await emit(env,{type:"docusign.webhook",contactId,envelopeId,status,payload});return Response.json({ok:true});}
  if(url.pathname==="/docusign/return"){
    const brand=brandName(env),assistant=assistantName(env),html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${brand} - Documents Submitted</title></head><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b"><div style="max-width:620px;margin:60px auto;padding:0 20px"><div style="background:#111;color:#fff;padding:24px 28px;border-bottom:5px solid #1c75bc;border-radius:14px 14px 0 0"><div style="font-size:26px;font-weight:800">${brand}</div><div style="margin-top:6px;opacity:.9">Documents submitted</div></div><div style="background:#fff;border:1px solid #e4e4e7;border-top:0;padding:30px;border-radius:0 0 14px 14px"><h2 style="margin:0 0 14px;color:#b51212">We received your documentation.</h2><p style="font-size:16px;line-height:1.55">Please wait for the confirmation text saying that ${assistant} received your signed documents before returning to the call.</p><div style="margin:22px 0;padding:16px;background:#f2f8fc;border:1px solid #f1caca;border-radius:10px;font-weight:700">The confirmation usually arrives in about 30 seconds.</div><p style="font-size:16px;line-height:1.55;margin-bottom:0">Once that text arrives, return to the conversation and ${assistant} will continue with scheduling.</p></div></div></body></html>`;
    return new Response(html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }
  return Response.json({ok:false,error:"Route not found"},{status:404});
}};
