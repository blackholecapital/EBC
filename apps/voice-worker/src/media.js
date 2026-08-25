import { createDeepgramTranscriber } from "./stt.js";
import { getEbcPreliminaryEstimate, getBuddyDemoOptions, parseBuddyChoice } from "./catalog.js";
import { chooseDeliveryOption, describeDeliveryOptions, naturalDeliveryLabel } from "./delivery.js";
import { eilaRuntimeEnabled, streamEilaSpeech, streamEilaTurn } from "./eila-runtime.js";
import { openAiTwilioAudio } from "./openai-tts.js";
import { conversationOpening, meaningfulBargeIn } from "./conversation.js";
import { parseRequestedAppointment } from "./appointment-time.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers:{"content-type":"application/json; charset=utf-8"} });
}
function base64ByteLength(value="") { const s=String(value); if(!s)return 0; const p=s.endsWith("==")?2:s.endsWith("=")?1:0; return Math.max(0,Math.floor(s.length*3/4)-p); }
function bytesToBase64(bytes){const v=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s="";for(let i=0;i<v.length;i+=0x8000)s+=String.fromCharCode(...v.subarray(i,i+0x8000));return btoa(s);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function normalizeUtterance(value=""){return String(value).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}
function naturalFirstName(value=""){const name=String(value||"").trim();return name?name.charAt(0).toUpperCase()+name.slice(1).toLowerCase():"";}
function greetingOnly(value=""){return /^(?:hello|hello there|hi|hi there|hey|hey there|good morning|good afternoon|good evening)$/.test(normalizeUtterance(value));}
function mentionsSigned(value=""){return /\b(signed|finished|done|submitted|sent it|completed)\b/i.test(String(value));}
function cleanRuntimeToken(value=""){return String(value||"").replace(/[^A-Za-z0-9_-]/g,"");}
function tenantContext(env,event={}){const payload=event.payload||{},contact=payload.contact||event.contact||{};return{tenantId:String(event.tenantId||payload.tenantId||env.TENANT_ID||"blackhole"),corporateId:String(event.corporateId||payload.corporateId||env.CORPORATE_ID||env.TENANT_ID||"blackhole"),locationId:String(event.locationId||payload.locationId||contact.locationId||contact.location_id||env.DEFAULT_LOCATION_ID||"corporate")};}

async function emitEvent(env,event){
  const tenant=tenantContext(env,event),tagged={...event,...tenant,ts:Date.now()};
  try{if(env.EVENTS)await env.EVENTS.send(tagged);}catch(e){console.error("media queue event failed",e);}
  try{if(env.ANALYTICS)env.ANALYTICS.writeDataPoint({blobs:[event.type||"stream.event",event.contactId||"",event.callSid||"",event.streamSid||"",tenant.tenantId,tenant.corporateId,tenant.locationId],doubles:[Date.now(),Number(event.mediaBytes||0),Number(event.mediaChunks||0)],indexes:[tenant.tenantId]});}catch(e){console.error("media analytics event failed",e);}
}
async function runtimeJson(env,path,body){
  const base=String(env.BUDDY_RUNTIME_URL||"").trim().replace(/\/$/,""); const token=cleanRuntimeToken(env.BUDDY_RUNTIME_TOKEN);
  if(!base)throw new Error("BUDDY_RUNTIME_URL is not configured"); if(!token)throw new Error("BUDDY_RUNTIME_TOKEN is not configured");
  const r=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json","x-runtime-token":token},body:JSON.stringify(body)});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{d={raw:t};}if(!r.ok)throw new Error(d?.detail||d?.error||`Buddy runtime ${path} failed (${r.status})`);return d;
}
function recentConversation(state){
  return (state.conversationHistory||[]).slice(-16).map(turn=>`${turn.role==="assistant"?"EBC AI":"CUSTOMER"}: ${turn.content}`).join("\n");
}
function availableProducts(options=[]){
  return options.length?options.map(option=>`${option.name}: ${option.short}. ${!option.needsReview&&option.basePrice!=null&&Number.isFinite(Number(option.basePrice))?`Starting at ${Number(option.basePrice).toLocaleString("en-US",{style:"currency",currency:"USD"})}.`:"Requires compatibility review and custom pricing."}`).join("\n"):"No fixed products are loaded for this inquiry; collect the requirements for an EBC specialist.";
}
function requestsSalesFollowup(value=""){return /\b(sales|human|person|representative|transfer|callback|call back|appointment|schedule|proposal|quote|estimate)\b/i.test(String(value));}
function requestsHumanHandoff(value=""){return /\b(sales(?:person| team)?|human|representative|transfer|callback|call back|have (?:someone|the team) call|talk to (?:someone|a person))\b/i.test(String(value));}
function requestsSalesAppointment(value=""){return /\b(?:appointment|meeting|consultation)\b|\b(?:schedule|book|set up|arrange)\b.{0,35}\b(?:call|time|sales|meeting|appointment)\b|\b(?:available|availability)\b.{0,35}\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(String(value));}
function requestsBringInAppointment(value=""){return /\b(?:bring|drop)(?: the cart| it| my cart| my vehicle)?\s+(?:in|off|down)\b|\b(?:in[- ]shop|service|inspection|evaluation)\s+(?:appointment|visit|time)\b|\b(?:appointment|visit|time)\b.{0,35}\b(?:bring|drop|shop|service|inspect|evaluation|look at)\b/i.test(String(value));}
function requestsPhoneConsultation(value=""){return /\b(?:phone|telephone|sales|consultation)\s+(?:call|appointment|consultation)\b|\b(?:schedule|book|set up|arrange)\b.{0,35}\b(?:phone call|consultation call|sales call)\b/i.test(String(value));}
function requestsEstimateDelivery(value=""){return /\b(?:email|send|prepare|create|get|receive)\b.{0,40}\b(?:estimate|quote|proposal)\b|\b(?:estimate|quote|proposal)\b.{0,40}\b(?:email|send|prepare|create|get|receive)\b/i.test(String(value));}
function confirmsEstimateDelivery(value=""){return /\b(?:send|email)(?: it| that| the estimate| the quote)?(?: now| please)?\b|\byou can send it\b|^(?:yes|yes please|sure|okay|ok|go ahead|do it|please do)[.! ]*$/i.test(String(value).trim());}
function offersEstimate(value=""){return /\b(?:email|send|prepare|put together|create)\b.{0,50}\b(?:estimate|quote|proposal)\b|\b(?:estimate|quote|proposal)\b.{0,50}\b(?:email|send|prepare|put together|create)\b/i.test(String(value));}
function offersAppointment(value=""){return /\b(?:schedule|arrange|request|book)\b.{0,45}\b(?:meeting|appointment|sales call|time with (?:the )?sales)\b|\b(?:meeting|appointment|sales call)\b.{0,45}\b(?:schedule|arrange|request|book)\b/i.test(String(value));}
function requestsCallClose(value=""){return /\b(?:no thanks|no thank you|that(?:'s| is) (?:all|it)|nothing else|all set|i(?:'ll| will) (?:just )?review (?:it|the estimate)|goodbye|bye for now|have a good (?:day|night))\b/i.test(String(value));}
function estimateRequirements(state,current=""){const turns=(state.conversationHistory||[]).filter(turn=>turn.role==="user").map(turn=>String(turn.content||"").trim()).filter(Boolean);if(current)turns.push(String(current).trim());return [...new Set(turns)].join(" ");}
function runtimeSalesPrompt(state,transcript,options=[],preface=""){
  return `SYSTEM: You are EBC AI, a warm, highly natural male project consultant for Everything Built Custom speaking on a live phone call. Sound like a capable human custom-cart specialist, never like a phone menu.

Everything Built Custom makes custom golf-cart and ATV accessories, including plug-and-play power and wire kits, fan systems, speaker and LED upgrades, programming support, roofs, enclosures, and one-off fabricated projects. The public phone number is (727) 416-WIRE. Supported brands shown on the site include Denago, Can-Am, Evolution, E-Z-GO, Honda, Polaris, and universal builds. Do not claim compatibility until the cart make, model, year, and connector or fitment details have been reviewed.
Lead first name: ${state.firstName||"unknown"}
Requested product or project: ${state.interest||"custom cart project"}
Customer location or shipping region: ${state.location||"not specified"}
Selected product: ${state.selectedProduct?.name||"none"}
Lead notes: ${state.comments||"none provided"}

CURRENT DEMO PRODUCTS:
${availableProducts(options)}

CALL STAGE: ${state.isFollowup?"Follow-up conversation with prior context already loaded.":state.openingResponseHandled?`Active project conversation; ${state.discoveryTurns} customer response(s) completed.`:"The customer is responding to EBC AI’s opening for the first time."}
PRIOR REQUIREMENTS SUMMARY: ${state.priorRequirementsSummary||"none"}
PRIOR ESTIMATE: ${state.estimateNumber||"none sent"}
ESTIMATE WORKFLOW: ${state.quoteSent?"A preliminary estimate was sent. Answer questions or changes first, then offer time with the EBC team once.":state.quoteRequested?"EBC AI has offered an estimate; a clear yes means the application will send it.":"No estimate has been offered yet."}
APPOINTMENT WORKFLOW: ${state.appointmentStatus||"No sales appointment requested."}${state.appointmentStart?` Proposed time: ${state.appointmentStart}.`:""}
CALL TRIGGER: ${state.triggerType||"new lead"}

RECENT CONVERSATION:
${recentConversation(state)||"EBC AI has just opened the call."}

PROSPECT JUST SAID:
${String(transcript||"")}

${preface?`EBC AI has already spoken this brief acknowledgement: "${preface}" Begin directly with the useful response and do not repeat or paraphrase that acknowledgement.`:""}

Never greet the customer again or reintroduce EBC AI or Everything Built Custom—the opening has already done that. Speak like a relaxed, curious project specialist, not a script. Follow the customer’s lead. Answer ordinary small talk and side questions naturally. Do not use canned acknowledgements as a complete response. Never invent live inventory, shipping times, compatibility, weather, news, or statistics. If current information is not in the context, say it needs confirmation and keep the exchange natural.

Invite the customer to explain what they want the cart to do or look like. Reflect back the important parts. Ask only one question at a time. Prioritize cart make, model, year, current wiring or connector details, desired accessory, color or finish, DIY versus installation or remote assist, location, and timeline—but do not interrogate them or repeat known details. Use prior context on follow-up calls.

When enough is known, reflect back two or three requirements, recommend the closest EBC fit, and briefly explain why. Then give a direct next step. The three calls to action are: email a preliminary estimate, request a phone consultation with the EBC team, or request an appointment to bring the cart in for an in-shop evaluation. Offer those choices naturally near the end of the exchange instead of ending without a next step. If a product requires review or has no approved starting price, offer to email confirmation that the estimate review was requested; never guess a price. Published starting prices may vary by upgrade, color, cart model, year, harness, shipping, tax, and installation. Explain that every product is built custom to order and any estimate is subject to compatibility and final configuration review. Do not mention numbered product options unless the customer asks for them. Do not claim an estimate, message, handoff, appointment, or email was sent until the application confirms it.

Most replies should be one to three short, natural sentences and under 60 words. Return only the exact words EBC AI should say.`;
}
async function runtimeSalesReply(env,state,transcript,options=[]){
  const prompt=runtimeSalesPrompt(state,transcript,options);
  const runtimeStartedAt=Date.now();
  const chat=await runtimeJson(env,"/chat",{text:prompt,firstName:state.firstName,interest:state.interest,location:state.location});
  console.log("EBC AI runtime response generated",{callSid:state.callSid,contactId:state.contactId,latencyMs:Date.now()-runtimeStartedAt});
  const reply=String(chat.response||"").trim();
  if(!reply)throw new Error("Buddy runtime returned an empty sales response");
  return reply;
}

async function runtimeTwilioAudio(env,text){
  if(String(env.OPENAI_API_KEY||"").trim()){
    try{
      const ttsStartedAt=Date.now();
      const premium=await openAiTwilioAudio(env,text);
      console.log("Buddy premium TTS generated",{provider:premium.provider,model:premium.model,voice:premium.voice,audioBytes:premium.audio.length,latencyMs:Date.now()-ttsStartedAt});
      return premium.audio;
    }catch(error){
      console.error("Premium OpenAI TTS failed; falling back to GPU Kokoro",error?.message||String(error));
    }
  }
  const base=String(env.BUDDY_RUNTIME_URL||"").trim().replace(/\/$/,""); const token=cleanRuntimeToken(env.BUDDY_RUNTIME_TOKEN);
  if(!base||!token)throw new Error("Buddy runtime is not configured");
  const r=await fetch(`${base}/tts/twilio`,{method:"POST",headers:{"content-type":"application/json","x-runtime-token":token},body:JSON.stringify({text})});
  if(!r.ok)throw new Error(`Buddy runtime TTS failed (${r.status}): ${(await r.text()).slice(0,240)}`);return new Uint8Array(await r.arrayBuffer());
}
async function conciergeRequest(env,path,payload){
  const secret=String(env.INTERNAL_CALL_SECRET||""); if(!secret)throw new Error("INTERNAL_CALL_SECRET is not configured for concierge handoff");
  const req=new Request(`https://concierge.internal${path}`,{method:"POST",headers:{"content-type":"application/json","x-internal-call-secret":secret},body:JSON.stringify(payload)});
  const publicBase=String(env.CONCIERGE_PUBLIC_URL||"https://ebc-concierge-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/,"");
  const r=env.CONCIERGE?await env.CONCIERGE.fetch(req):await fetch(`${publicBase}${path}`,{method:"POST",headers:{"content-type":"application/json","x-internal-call-secret":secret},body:JSON.stringify(payload)});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{d={raw:t};}if(!r.ok||d?.ok===false){console.error("Concierge handoff rejected",{path,status:r.status,body:d,via:env.CONCIERGE?"service-binding":"public-fetch"});throw new Error(d?.error||`Concierge request failed (${r.status})`);}return d;
}
const notifyProductInterest=(env,p)=>conciergeRequest(env,"/internal/product-interest",p);
const sendPreliminaryEstimate=(env,p)=>conciergeRequest(env,"/internal/preliminary-estimate",p);
const createSalesHandoff=(env,p)=>conciergeRequest(env,"/internal/sales-handoff",p);
const createSalesAppointment=(env,p)=>conciergeRequest(env,"/internal/sales-appointment",p);
const getDeliveryOptions=(env,id)=>conciergeRequest(env,"/internal/delivery-options",{contactId:id});
const scheduleDelivery=(env,id,o)=>conciergeRequest(env,"/internal/delivery-schedule",{contactId:id,startIso:o.startIso,endIso:o.endIso,timeZone:o.timeZone});
async function getContactStatus(env,id){if(!id)return null;try{return await conciergeRequest(env,"/internal/contact-status",{contactId:id});}catch(e){console.error("Buddy contact status lookup failed",{contactId:id,error:e?.message||String(e)});return null;}}
async function completeTwilioCall(env,callSid){const a=String(env.TWILIO_ACCOUNT_SID||""),t=String(env.TWILIO_AUTH_TOKEN||"");if(!a||!t||!callSid)return;await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(a)}/Calls/${encodeURIComponent(callSid)}.json`,{method:"POST",headers:{Authorization:`Basic ${btoa(`${a}:${t}`)}`,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({Status:"completed"}).toString()}).catch(()=>{});}

export function handleTwilioMediaSocket(request,env,ctx){
  if((request.headers.get("Upgrade")||"").toLowerCase()!=="websocket")return json({ok:false,error:"Expected Upgrade: websocket"},426);
  const pair=new WebSocketPair(); const [client,server]=Object.values(pair); server.accept();
  const brand=String(env.BRAND_NAME||"Everything Built Custom");
  const state={
    connectedAt:Date.now(),streamSid:"",callSid:"",accountSid:"",contactId:"",firstName:"",lastName:"",phone:"",email:"",interest:"",location:"",comments:"",leadScore:"",preferredContactTime:"",tenantId:String(env.TENANT_ID||"blackhole"),corporateId:String(env.CORPORATE_ID||env.TENANT_ID||"blackhole"),locationId:String(env.DEFAULT_LOCATION_ID||"corporate"),
    mediaChunks:0,mediaBytes:0,lastTimestamp:"",lastSequenceNumber:"",transcriptCount:0,stt:null,utteranceParts:[],turnGeneration:0,responseCount:0,
    selectedProduct:null,documentStatus:"Not sent",signatureAcknowledged:false,deliveryOptions:[],awaitingDeliveryChoice:false,deliveryScheduled:false,
    optionsOffered:false,awaitingProductChoice:false,lastUtterance:"",lastUtteranceAt:0,lastClarifyAt:0,lastPendingDocPromptAt:0,
    conversationHistory:[],discoveryTurns:0,openingSent:false,openingStartedAt:0,openingAudioStarted:false,openingPlaybackComplete:false,openingMarkName:"",activeMarkName:"",playbackActive:false,openingResponseHandled:false,quoteRequested:false,quoteSent:false,estimateNumber:"",finalFlushTimer:null,
    triggerType:"",priorRequirementsSummary:"",priorSelectedProduct:"",estimateStatus:"",callStatus:"",isFollowup:false,contextLoaded:false,pendingBargeIn:false,appointmentStatus:"",appointmentStart:"",appointmentOffered:false,closingScheduled:false,
  };
  const pushEvent=(e)=>{const p=emitEvent(env,{tenantId:state.tenantId,corporateId:state.corporateId,locationId:state.locationId,...e});if(ctx?.waitUntil)ctx.waitUntil(p);else p.catch(()=>{});};
  const pushAssistantTranscript=(text,eventType,extra={})=>{const response=String(text||"").trim();if(!response)return;pushEvent({type:"buddy.transcript.assistant",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,response,workflowType:eventType,...extra});};
  const sendTwilioClear=()=>{state.playbackActive=false;state.activeMarkName="";if(state.streamSid)try{server.send(JSON.stringify({event:"clear",streamSid:state.streamSid}));}catch{}};
  function sendTwilioAudioBase64(payload){if(!state.streamSid||!payload)return;state.playbackActive=true;server.send(JSON.stringify({event:"media",streamSid:state.streamSid,media:{payload}}));}
  function sendTwilioMark(markName){if(!state.streamSid||!markName)return;state.activeMarkName=markName;server.send(JSON.stringify({event:"mark",streamSid:state.streamSid,mark:{name:markName}}));}
  function sendTwilioAudio(audioBytes,markName){if(!state.streamSid||!audioBytes?.length)return;sendTwilioAudioBase64(bytesToBase64(audioBytes));sendTwilioMark(markName);}
  async function speak(text,generation,eventType="buddy.turn.completed"){
    const openingEvent=eventType==="buddy.sales.opening"||eventType==="buddy.sales.followup-opening";
    if(generation!==state.turnGeneration)return;
    pushAssistantTranscript(text,eventType);
    if(eilaRuntimeEnabled(env)){
      try{
        const phrases=[String(text)];
        let audioBytes=0,audioChunks=0,firstAudioMs=null,totalLatencyMs=0;
        for(const phrase of phrases){
          const streamed=await streamEilaSpeech(env,phrase,{onAudio:(payload)=>{if(generation!==state.turnGeneration)return false;if(openingEvent)state.openingAudioStarted=true;sendTwilioAudioBase64(payload);return true;}});
          if(streamed.cancelled||generation!==state.turnGeneration)return;
          audioBytes+=streamed.audioBytes;audioChunks+=streamed.audioChunks;totalLatencyMs+=streamed.totalLatencyMs;
          if(firstAudioMs===null)firstAudioMs=streamed.firstAudioMs;
        }
        state.responseCount+=1;const markName=`eila-${state.responseCount}-${Date.now()}`;if(openingEvent)state.openingMarkName=markName;sendTwilioMark(markName);
        console.log("EILA streamed voice response sent",{callSid:state.callSid,contactId:state.contactId,responseText:text,audioBytes,audioChunks,firstAudioMs,totalLatencyMs,eventType});
        pushEvent({type:eventType,callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,response:text,audioBytes,firstAudioMs,totalLatencyMs,runtime:"eila-voice-runtime"});
        return;
      }catch(error){
        console.error("EILA speech stream failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error),partialAudio:Boolean(error?.partialAudio)});
        if(error?.partialAudio)throw error;
      }
    }
    const audio=await runtimeTwilioAudio(env,text); if(generation!==state.turnGeneration)return;
    state.responseCount+=1; const markName=`buddy-${state.responseCount}-${Date.now()}`; if(openingEvent)state.openingMarkName=markName; sendTwilioAudio(audio,markName);
    console.log("EBC AI voice response sent",{callSid:state.callSid,contactId:state.contactId,responseText:text,audioBytes:audio.length,eventType});
    pushEvent({type:eventType,callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,response:text,audioBytes:audio.length});
  }
  async function speakSalesTurn(transcript,options,generation,eventType){
    const preface = "";
    let responseText="";
    let transcriptRecorded=false;
    if(eilaRuntimeEnabled(env)){
      try{
        const streamed=await streamEilaTurn(env,{prompt:runtimeSalesPrompt(state,transcript,options,preface),preface,sessionId:state.callSid,tenantId:state.tenantId,assistantName:String(env.ASSISTANT_NAME||"EBC AI"),metadata:{contactId:state.contactId,interest:state.interest,location:state.location,locationId:state.locationId}},{onAudio:(payload)=>{if(generation!==state.turnGeneration)return false;sendTwilioAudioBase64(payload);return true;},onTextCompleted:(text)=>{responseText=String(text||"").trim();if(responseText&&!transcriptRecorded){transcriptRecorded=true;pushAssistantTranscript(responseText,eventType,{runtime:"eila-voice-runtime"});}}});
        if(streamed.cancelled||generation!==state.turnGeneration)return "";
        if(!streamed.text)throw new Error("EILA runtime returned an empty sales response");
        state.responseCount+=1;sendTwilioMark(`eila-${state.responseCount}-${Date.now()}`);
        responseText=streamed.text.trim();
        if(!transcriptRecorded){transcriptRecorded=true;pushAssistantTranscript(responseText,eventType,{runtime:"eila-voice-runtime"});}
        console.log("EILA streamed sales turn sent",{callSid:state.callSid,contactId:state.contactId,responseText,audioBytes:streamed.audioBytes,audioChunks:streamed.audioChunks,firstAudioMs:streamed.firstAudioMs,totalLatencyMs:streamed.totalLatencyMs,eventType});
        pushEvent({type:eventType,callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,response:responseText,audioBytes:streamed.audioBytes,firstAudioMs:streamed.firstAudioMs,totalLatencyMs:streamed.totalLatencyMs,runtime:"eila-voice-runtime"});
        return responseText;
      }catch(error){
        console.error("EILA sales stream failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error),partialAudio:Boolean(error?.partialAudio)});
        responseText=String(error?.partialText||responseText||"").trim();
        if(responseText){
          if(!transcriptRecorded)pushAssistantTranscript(responseText,eventType,{runtime:"eila-voice-runtime",partial:true});
          if(error?.partialAudio){state.responseCount+=1;sendTwilioMark(`eila-partial-${state.responseCount}-${Date.now()}`);return responseText;}
        }
        if(error?.partialAudio)throw error;
      }
    }
    responseText=await runtimeSalesReply(env,state,transcript,options);
    if(generation!==state.turnGeneration)return "";
    await speak(responseText,generation,eventType);
    return responseText;
  }
  function offerText(options){
    const assistant=String(env.ASSISTANT_NAME||"EBC AI"),brand=String(env.BRAND_NAME||"Everything Built Custom");
    if(!options.length)return `Hi, this is ${assistant} with ${brand}. That project needs a compatibility and custom-pricing review.`;
    const one=options[0]?.name||"option one",two=options[1]?.name||"option two";
    const hello=state.firstName?`Hi ${state.firstName}, this is ${assistant}, your custom-cart project assistant with ${brand}.`:`Hi, this is ${assistant}, your custom-cart project assistant with ${brand}.`;
    return `${hello} I have two choices for ${state.interest||"your request"}: option one, ${one}, or option two, ${two}. Which one works for you?`;
  }
  function openingText(){
    return conversationOpening(state,{assistant:String(env.ASSISTANT_NAME||"EBC AI"),brand});
  }
  function duplicateUtterance(clean){
    const n=normalizeUtterance(clean),now=Date.now(); if(!n)return true;
    const dup=n===state.lastUtterance && now-state.lastUtteranceAt<2500; state.lastUtterance=n; state.lastUtteranceAt=now; return dup;
  }
  function rememberSalesTurn(clean,responseText){
    state.conversationHistory.push({role:"user",content:clean},{role:"assistant",content:responseText});
    state.openingResponseHandled=true;
    if(offersEstimate(responseText))state.quoteRequested=true;
    if(offersAppointment(responseText))state.appointmentOffered=true;
  }
  function handoffPayload(requirements,reason){return{contactId:state.contactId,firstName:state.firstName,lastName:state.lastName,phone:state.phone,email:state.email,interest:state.interest,location:state.location,comments:state.comments,leadScore:state.leadScore,preferredContactTime:state.preferredContactTime,requirements,reason,callSid:state.callSid,source:"ebc-voice-worker"};}

  function processUtterance(transcript){
    const clean=String(transcript||"").trim(); if(!clean||!state.streamSid||duplicateUtterance(clean))return;
    if(state.openingSent&&!state.openingAudioStarted&&!state.openingPlaybackComplete){console.log("Deferred transcript while EBC AI opening loads",{callSid:state.callSid,contactId:state.contactId,transcript:clean});pushEvent({type:"buddy.sales.pre-opening-transcript-deferred",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean});return;}
    if(state.openingSent&&!state.openingPlaybackComplete&&greetingOnly(clean)&&Date.now()-state.openingStartedAt<20000){console.log("Suppressed greeting captured during EBC AI opening",{callSid:state.callSid,contactId:state.contactId,transcript:clean});pushEvent({type:"buddy.sales.opening-overlap-suppressed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean});return;}
    if(state.openingSent&&!state.openingPlaybackComplete){state.openingPlaybackComplete=true;sendTwilioClear();}
    const generation=++state.turnGeneration; const startedAt=Date.now();
    const work=(async()=>{
      try{
        pushEvent({type:"buddy.turn.started",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean});
        const options=getBuddyDemoOptions(state.interest);
        if(requestsCallClose(clean)&&(state.quoteSent||state.appointmentStatus||/\b(?:goodbye|bye for now|have a good (?:day|night))\b/i.test(clean))){
          const closing=state.quoteSent
            ? `Of course${state.firstName?`, ${state.firstName}`:""}. Take your time reviewing the estimate, and use the call link in the email whenever you'd like to make a change or talk it through. Thanks for speaking with me today—have a great day.`
            : `Of course${state.firstName?`, ${state.firstName}`:""}. Thanks for speaking with me today. If anything comes up, just get back in touch and I'll pick up where we left off. Have a great day.`;
          await speak(closing,generation,"buddy.sales.call-closing");
          state.closingScheduled=true;
          if(ctx?.waitUntil)ctx.waitUntil((async()=>{await sleep(11000);await completeTwilioCall(env,state.callSid);})());
          return;
        }
        const estimateIntent=requestsEstimateDelivery(clean)||(!state.quoteSent&&state.quoteRequested&&confirmsEstimateDelivery(clean));
        if(estimateIntent){
          state.quoteRequested=true;
          const requirements=estimateRequirements(state,clean);
          const quote=getEbcPreliminaryEstimate({interest:state.interest,selectedProduct:state.selectedProduct?.name||state.priorSelectedProduct,location:state.location,conversation:requirements});
          if(state.quoteSent){
            await speak(`Your Everything Built Custom estimate ${state.estimateNumber||""} has already been emailed to ${state.email||"the address on your request"}.`,generation,"buddy.estimate.already-sent");
            return;
          }
          if(!quote){
            try{
              const result=await createSalesHandoff(env,{...handoffPayload(requirements,"Cart compatibility or custom pricing review required"),notifyCustomer:true,messageType:"ebc-estimate-review-requested"});
              state.estimateStatus="Review requested";
              const delivered=result?.email?.ok===true;
              await speak(delivered
                ? `I emailed ${state.email||"the address on your request"} to confirm that your custom estimate review is underway. The EBC team will verify the cart fitment and pricing before sending the actual estimate. Would you prefer a phone consultation, or would you like to request a time to bring the cart in?`
                : "I recorded the custom estimate request for the EBC team, but I couldn't confirm the email delivery. Would you prefer a phone consultation, or would you like to request a time to bring the cart in?",generation,"buddy.estimate.needs-review");
            }
            catch(error){console.error("EBC sales handoff failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error)});await speak("That project needs a compatibility review, and I couldn’t confirm the team handoff. Your conversation is still attached to this lead for review.",generation,"buddy.estimate.needs-review");}
            pushEvent({type:"buddy.estimate.needs-review",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,requirements,message:"Cart compatibility or custom pricing review required"});
            return;
          }
          try{
            const result=await sendPreliminaryEstimate(env,{contactId:state.contactId,firstName:state.firstName,lastName:state.lastName,phone:state.phone,email:state.email,interest:state.interest,location:state.location,comments:state.comments,leadScore:state.leadScore,preferredContactTime:state.preferredContactTime,quote,requirements});
            state.quoteSent=result?.email?.ok===true;
            state.estimateNumber=String(result?.quote?.estimateNumber||"");
            if(!state.quoteSent)throw new Error(result?.email?.error||"Resend did not confirm estimate delivery");
            state.conversationHistory.push({role:"user",content:clean},{role:"assistant",content:`Estimate ${state.estimateNumber} emailed successfully.`});
            state.appointmentOffered=true;
            await speak(`Done—I emailed estimate ${state.estimateNumber} for ${quote.serviceName}, starting at ${new Intl.NumberFormat("en-US",{style:"currency",currency:quote.currency||"USD"}).format(quote.monthlyTotal)} before selected upgrades, shipping, tax, or installation. The email also has a link to call me back for questions or changes. Would you like me to request time with the EBC team?`,generation,"buddy.estimate.sent");
          }catch(error){
            console.error("EBC estimate delivery failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error)});
            pushEvent({type:"buddy.estimate.failed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,error:error?.message||String(error)});
            try{await createSalesHandoff(env,handoffPayload(requirements,`Estimate delivery failed: ${error?.message||"unknown error"}`));await speak("I couldn’t confirm the email, so I created a sales-team handoff with your requirements instead of telling you it was sent.",generation,"buddy.estimate.failed");}
            catch(handoffError){console.error("EBC fallback handoff failed",{callSid:state.callSid,contactId:state.contactId,error:handoffError?.message||String(handoffError)});await speak("I couldn’t confirm the estimate email or the sales handoff. Your conversation is still attached to this lead for review.",generation,"buddy.estimate.failed");}
          }
          return;
        }

        const proposedAppointment=parseRequestedAppointment(clean,{timeZone:"America/New_York"});
        const bringInAppointment=requestsBringInAppointment(clean);
        const phoneConsultation=requestsPhoneConsultation(clean);
        if(requestsSalesAppointment(clean)||bringInAppointment||phoneConsultation||(state.appointmentOffered&&(confirmsEstimateDelivery(clean)||proposedAppointment))){
          const requirements=estimateRequirements(state,clean);
          const appointmentType=bringInAppointment?"bring-in-evaluation":"phone-consultation";
          const appointmentLabel=appointmentType==="bring-in-evaluation"?"in-shop cart evaluation":"phone consultation";
          try{
            const result=await createSalesAppointment(env,{...handoffPayload(requirements,`Customer requested an ${appointmentLabel}`),action:"request",appointmentType,notes:requirements,timeZone:"America/New_York",startIso:proposedAppointment?.startIso||""});
            state.appointmentStatus="Requested";state.appointmentStart=String(result?.appointment?.start||proposedAppointment?.startIso||"");
            const timeLine=proposedAppointment?` for ${proposedAppointment.label}`:"";
            await speak(`I recorded your ${appointmentLabel} request${timeLine}. It is pending the team's approval, not booked yet. Once they approve it or suggest another time, you'll receive a confirmation by text or email.`,generation,"buddy.sales.appointment-requested");
          }catch(error){
            console.error("EBC sales appointment request failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error)});
            await speak("I couldn't confirm the appointment request, so I won't pretend it was booked. Your conversation is still attached to this lead for the sales team to review.",generation,"buddy.sales.appointment-failed");
          }
          return;
        }

        if(requestsHumanHandoff(clean)){
          const requirements=estimateRequirements(state,clean);
          try{await createSalesHandoff(env,handoffPayload(requirements,"Customer requested sales follow-up"));await speak("Absolutely. I created a handoff for the Everything Built Custom sales team with what we discussed, so they can follow up without making you repeat everything.",generation,"buddy.sales.handoff-created");}
          catch(error){console.error("EBC requested sales handoff failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error)});await speak("I couldn’t confirm the sales handoff, so I won’t pretend it was sent. Your conversation is still attached to this lead for review.",generation,"buddy.sales.handoff-failed");}
          return;
        }

        if(!state.selectedProduct && options.length){
          const choiceIndex=parseBuddyChoice(clean);
          if(choiceIndex>=0&&options[choiceIndex]){
            const selected=options[choiceIndex]; state.selectedProduct=selected; state.awaitingProductChoice=false;
            const payload={type:"buddy.product.selected",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,firstName:state.firstName,lastName:state.lastName,phone:state.phone,email:state.email,category:state.interest,interest:state.interest,location:state.location,comments:state.comments,leadScore:state.leadScore,preferredContactTime:state.preferredContactTime,selectionNumber:choiceIndex+1,productId:selected.id,productName:selected.name};
            pushEvent(payload);
            try{
              await notifyProductInterest(env,{...payload,requirements:estimateRequirements(state,clean)});
              const responseText=await speakSalesTurn(clean,options,generation,"buddy.product.interest-saved");
              if(responseText)rememberSalesTurn(clean,responseText);
            }catch(error){console.error("Buddy product interest persistence failed",{contactId:state.contactId,productName:selected.name,error:error?.message||String(error)});if(generation===state.turnGeneration){const responseText=await speakSalesTurn(clean,options,generation,"buddy.product.interest-local");if(responseText)rememberSalesTurn(clean,responseText);}}
            return;
          }

          state.discoveryTurns+=1;
          const followup=requestsSalesFollowup(clean);
          const responseText=await speakSalesTurn(clean,options,generation,followup?"buddy.sales.followup-acknowledged":"buddy.sales.discovery-response");
          if(generation!==state.turnGeneration)return;
          if(!responseText)return;
          rememberSalesTurn(clean,responseText);
          state.optionsOffered=state.optionsOffered||/\boption (?:one|two|1|2)\b/i.test(responseText);
          state.awaitingProductChoice=state.optionsOffered;
          pushEvent({type:followup?"buddy.sales.followup-requested":"buddy.sales.discovery",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean,response:responseText,interest:state.interest,discoveryTurns:state.discoveryTurns,followupRequested:followup});
          return;
        }

        if(state.selectedProduct&&state.contactId){
          const status=await getContactStatus(env,state.contactId); if(status?.documentStatus)state.documentStatus=status.documentStatus;if(status?.deliveryAt)state.deliveryScheduled=true;
          if(state.deliveryScheduled){await speak(`You're all set${state.firstName?`, ${state.firstName}`:""}. Your project appointment is already scheduled. Thanks for calling ${brand}. Have a great day.`,generation,"buddy.delivery.already-scheduled");if(ctx?.waitUntil)ctx.waitUntil((async()=>{await sleep(12000);await completeTwilioCall(env,state.callSid);})());return;}

          if(String(state.documentStatus).toLowerCase()!=="signed"){
            if(mentionsSigned(clean)){
              const now=Date.now();if(now-state.lastPendingDocPromptAt>7000){state.lastPendingDocPromptAt=now;await speak("Thanks. I'm waiting for the agreement system to confirm it. Once that arrives, I can help with the next step.",generation,"buddy.docusign.awaiting-confirmation");}
              return;
            }
            state.discoveryTurns+=1;
            const followup=requestsSalesFollowup(clean);
            const responseText=await speakSalesTurn(clean,options,generation,followup?"buddy.sales.followup-acknowledged":"buddy.sales.discovery-response");
            if(generation!==state.turnGeneration)return;
            if(!responseText)return;
            rememberSalesTurn(clean,responseText);
            pushEvent({type:followup?"buddy.sales.followup-requested":"buddy.sales.discovery",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean,response:responseText,selectedProduct:state.selectedProduct?.name||"",discoveryTurns:state.discoveryTurns,followupRequested:followup});
            return;
          }

          if(!state.signatureAcknowledged){
            state.signatureAcknowledged=true;
            try{const delivery=await getDeliveryOptions(env,state.contactId);state.deliveryOptions=delivery?.options||[];state.awaitingDeliveryChoice=state.deliveryOptions.length>0;await speak(`Perfect${state.firstName?`, ${state.firstName}`:""}. I have your signed project agreement for ${state.selectedProduct.name}. Let's schedule your build or installation consultation. ${describeDeliveryOptions(state.deliveryOptions)}`,generation,"buddy.docusign.signed-acknowledged");}
            catch(error){console.error("EBC project scheduling options failed",{contactId:state.contactId,error:error?.message||String(error)});await speak(`Perfect${state.firstName?`, ${state.firstName}`:""}. I have your signed project agreement. I'm having trouble loading the build and installation calendar right now.`,generation,"buddy.delivery.options-failed");}
            return;
          }

          if(state.awaitingDeliveryChoice&&state.deliveryOptions.length){
            const selectedDelivery=chooseDeliveryOption(clean,state.deliveryOptions);
            if(!selectedDelivery){const now=Date.now();if(now-state.lastClarifyAt>6000){state.lastClarifyAt=now;await speak(describeDeliveryOptions(state.deliveryOptions),generation,"buddy.delivery.choice-clarify");}return;}
            const spokenSelection=naturalDeliveryLabel(selectedDelivery);
            await speak(`Perfect. I'll put you down for ${spokenSelection}. Give me just a second while I add that to the calendar.`,generation,"buddy.delivery.scheduling");
            try{const result=await scheduleDelivery(env,state.contactId,selectedDelivery);state.deliveryScheduled=true;state.awaitingDeliveryChoice=false;const scheduledOption={...selectedDelivery,startIso:result?.delivery?.start||selectedDelivery.startIso,timeZone:result?.delivery?.timeZone||selectedDelivery.timeZone};const label=naturalDeliveryLabel(scheduledOption);console.log("EBC project consultation scheduled",{contactId:state.contactId,calendarEventId:result?.delivery?.id||"",deliveryAt:result?.delivery?.start||selectedDelivery.startIso,smsOk:result?.sms?.ok??null,emailOk:result?.email?.ok??null});await speak(`You're confirmed for ${label}. I sent your project consultation confirmation by text and email. Thanks for calling ${brand}. Have a great day.`,generation,"buddy.delivery.confirmed");if(ctx?.waitUntil)ctx.waitUntil((async()=>{await sleep(14000);await completeTwilioCall(env,state.callSid);})());}
            catch(error){console.error("Buddy delivery scheduling failed",{contactId:state.contactId,error:error?.message||String(error)});try{const refreshed=await getDeliveryOptions(env,state.contactId);state.deliveryOptions=refreshed?.options||[];}catch{}await speak(`That time just got taken. ${describeDeliveryOptions(state.deliveryOptions)}`,generation,"buddy.delivery.conflict");}
            return;
          }
        }

        const followup=requestsSalesFollowup(clean);
        const responseText=await speakSalesTurn(clean,options,generation,followup?"buddy.sales.followup-acknowledged":"buddy.voice.response");
        if(generation!==state.turnGeneration)return;
        if(!responseText)return;
        rememberSalesTurn(clean,responseText);
        pushEvent({type:followup?"buddy.sales.followup-requested":"buddy.turn.completed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean,response:responseText,latencyMs:Date.now()-startedAt,followupRequested:followup});
      }catch(error){console.error("Buddy turn failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error)});pushEvent({type:"buddy.turn.failed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,error:error?.message||String(error)});}
    })(); if(ctx?.waitUntil)ctx.waitUntil(work);else work.catch(()=>{});
  }

  function clearFinalFlush(){if(state.finalFlushTimer!==null){clearTimeout(state.finalFlushTimer);state.finalFlushTimer=null;}}
  function flushUtterance(reason="unknown"){clearFinalFlush();if(!state.utteranceParts.length)return;const t=state.utteranceParts.join(" ").replace(/\s+/g," ").trim();state.utteranceParts=[];console.log("Flushing caller utterance",{callSid:state.callSid,contactId:state.contactId,reason,transcript:t});processUtterance(t);}
  function scheduleFinalFlush(transcript=""){
    clearFinalFlush();
    const terminal=/[.!?][\"')\]]?$/.test(String(transcript).trim());
    const configured=Number(terminal?env.DEEPGRAM_TERMINAL_GRACE_MS:env.DEEPGRAM_FINAL_GRACE_MS);
    const graceMs=Number.isFinite(configured)&&configured>=100?configured:(terminal?350:900);
    state.finalFlushTimer=setTimeout(()=>{state.finalFlushTimer=null;flushUtterance(terminal?"terminal-final-grace":"final-grace");},graceMs);
  }
  function startTranscription(){
    if(state.stt||!env.DEEPGRAM_API_KEY)return;
    state.stt=createDeepgramTranscriber(env,{
      onOpen:({model})=>{console.log("Deepgram STT connected",{callSid:state.callSid,contactId:state.contactId,model});pushEvent({type:"stt.connected",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,model});},
      onTranscript:({transcript,isFinal,speechFinal,confidence})=>{clearFinalFlush();if(isFinal)state.transcriptCount+=1;console.log("Deepgram transcript",{callSid:state.callSid,contactId:state.contactId,transcript,isFinal,speechFinal,confidence});if((state.playbackActive||state.pendingBargeIn)&&meaningfulBargeIn({transcript,confidence,isFinal},env)){state.pendingBargeIn=false;state.turnGeneration+=1;sendTwilioClear();pushEvent({type:"buddy.audio.interrupted",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript,confidence,isFinal});}if(isFinal){state.utteranceParts.push(transcript);pushEvent({type:"stt.transcript.final",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript,confidence,speechFinal});if(speechFinal)flushUtterance("speech-final");else scheduleFinalFlush(transcript);}},
      onSpeechStarted:()=>{state.pendingBargeIn=state.playbackActive;pushEvent({type:"stt.speech.started",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,pendingBargeIn:state.pendingBargeIn});},
      onUtteranceEnd:()=>{flushUtterance("utterance-end");pushEvent({type:"stt.utterance.end",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId});},
      onClose:({code,reason})=>{console.log("Deepgram STT closed",{callSid:state.callSid,code,reason});pushEvent({type:"stt.closed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,closeCode:String(code||"")});},
      onError:()=>{console.error("Deepgram STT websocket error",{callSid:state.callSid});pushEvent({type:"stt.error",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId});},
    });
  }
  function stopTranscription(){clearFinalFlush();try{state.stt?.finalize();}catch{}try{state.stt?.close();}catch{}state.stt=null;}
  pushEvent({type:"stream.websocket.connected"});

  server.addEventListener("message",(event)=>{
    if(typeof event.data!=="string")return;let message;try{message=JSON.parse(event.data);}catch{return;}const type=String(message.event||"unknown");state.lastSequenceNumber=String(message.sequenceNumber||state.lastSequenceNumber||"");
    if(type==="connected"){console.log("Twilio media connected",{protocol:message.protocol||"",version:message.version||""});return;}
    if(type==="start"){
      const start=message.start||{},params=start.customParameters||{};state.streamSid=String(start.streamSid||message.streamSid||"");state.callSid=String(start.callSid||"");state.accountSid=String(start.accountSid||"");state.contactId=String(params.contactId||"");state.firstName=String(params.firstName||"");state.lastName=String(params.lastName||"");state.phone=String(params.phone||"");state.email=String(params.email||"");state.interest=String(params.interest||"");state.location=String(params.location||"");state.comments=String(params.comments||"");state.leadScore=String(params.leadScore||"");state.preferredContactTime=String(params.preferredContactTime||"");state.triggerType=String(params.triggerType||"");state.priorSelectedProduct=String(params.selectedProduct||"");state.priorRequirementsSummary=String(params.requirementsSummary||"");state.estimateNumber=String(params.estimateNumber||"");state.estimateStatus=String(params.estimateStatus||"");state.appointmentStatus=String(params.appointmentStatus||"");state.appointmentStart=String(params.appointmentStart||"");state.callStatus=String(params.callStatus||"");state.quoteSent=Boolean(state.estimateNumber||state.estimateStatus.toLowerCase()==="sent");state.isFollowup=/^(?:sms-reply|email-call-link|customer-callback|manual|dashboard)$/i.test(state.triggerType)||Boolean(state.priorSelectedProduct||state.priorRequirementsSummary||state.estimateNumber||state.appointmentStatus||state.callStatus);if(state.priorSelectedProduct)state.selectedProduct=getBuddyDemoOptions(state.interest).find(option=>option.name===state.priorSelectedProduct)||{id:"persisted-selection",name:state.priorSelectedProduct};state.tenantId=String(params.tenantId||state.tenantId);state.corporateId=String(params.corporateId||state.corporateId);state.locationId=String(params.locationId||state.locationId);const f=start.mediaFormat||{};
      console.log("Twilio media stream started",{streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,encoding:f.encoding||"",sampleRate:f.sampleRate||"",channels:f.channels||"",sttConfigured:Boolean(env.DEEPGRAM_API_KEY),buddyRuntimeConfigured:Boolean(env.BUDDY_RUNTIME_URL&&env.BUDDY_RUNTIME_TOKEN),premiumTtsConfigured:Boolean(env.OPENAI_API_KEY),demoChoices:getBuddyDemoOptions(state.interest).length});pushEvent({type:"stream.media.started",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,firstName:state.firstName,interest:state.interest,location:state.location,leadScore:state.leadScore,encoding:String(f.encoding||""),sampleRate:Number(f.sampleRate||0),channels:Number(f.channels||0)});startTranscription();
      if(!state.openingSent){state.openingSent=true;const beginOpening=(async()=>{const status=await Promise.race([getContactStatus(env,state.contactId),sleep(1000).then(()=>null)]);if(status){const prior=Array.isArray(status.recentConversation)?status.recentConversation:[];state.conversationHistory=prior.map(turn=>({role:turn.role==="assistant"?"assistant":"user",content:String(turn.content||"")})).filter(turn=>turn.content);state.priorRequirementsSummary=String(status.requirementsSummary||state.priorRequirementsSummary||"");state.priorSelectedProduct=String(status.selectedProduct||state.priorSelectedProduct||"");state.estimateNumber=String(status.estimateNumber||state.estimateNumber||"");state.estimateStatus=String(status.estimateStatus||state.estimateStatus||"");state.callStatus=String(status.callStatus||state.callStatus||"");state.quoteSent=Boolean(state.estimateNumber||state.estimateStatus.toLowerCase()==="sent");state.documentStatus=String(status.documentStatus||state.documentStatus);state.deliveryScheduled=Boolean(status.deliveryAt||String(status.deliveryStatus||"").toLowerCase()==="scheduled");state.appointmentStatus=String(status.appointmentStatus||state.appointmentStatus||"");state.appointmentStart=String(status.appointmentStart||state.appointmentStart||"");if(state.priorSelectedProduct)state.selectedProduct=getBuddyDemoOptions(state.interest).find(option=>option.name===state.priorSelectedProduct)||{id:"persisted-selection",name:state.priorSelectedProduct};state.isFollowup=state.isFollowup||prior.length>0||Boolean(state.priorRequirementsSummary||state.estimateNumber||state.priorSelectedProduct||state.appointmentStatus||state.callStatus);}state.contextLoaded=true;state.openingStartedAt=Date.now();const generation=++state.turnGeneration;const opening=openingText();state.conversationHistory.push({role:"assistant",content:opening});pushEvent({type:"buddy.conversation.context-loaded",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,isFollowup:state.isFollowup,priorTurns:Math.max(0,state.conversationHistory.length-1),estimateNumber:state.estimateNumber,triggerType:state.triggerType});await speak(opening,generation,state.isFollowup?"buddy.sales.followup-opening":"buddy.sales.opening");})();if(ctx?.waitUntil)ctx.waitUntil(beginOpening);else beginOpening.catch(error=>console.error("EBC AI opening failed",error));}
      return;
    }
    if(type==="media"){const media=message.media||{},payload=String(media.payload||"");state.mediaChunks+=1;state.mediaBytes+=base64ByteLength(payload);state.lastTimestamp=String(media.timestamp||state.lastTimestamp||"");if(payload&&state.stt)state.stt.sendBase64(payload);if(state.mediaChunks%250===0)console.log("Twilio media heartbeat",{streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,timestamp:state.lastTimestamp,transcriptCount:state.transcriptCount,responseCount:state.responseCount});return;}
    if(type==="dtmf"){pushEvent({type:"stream.media.dtmf",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,digit:String(message.dtmf?.digit||"")});return;}
    if(type==="mark"){const markName=String(message.mark?.name||"");if(!state.activeMarkName||markName===state.activeMarkName){state.playbackActive=false;state.pendingBargeIn=false;state.activeMarkName="";}if(markName&&markName===state.openingMarkName)state.openingPlaybackComplete=true;pushEvent({type:"buddy.audio.mark",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,name:markName});return;}
    if(type==="stop"){const stop=message.stop||{};state.streamSid=state.streamSid||String(message.streamSid||"");state.callSid=state.callSid||String(stop.callSid||"");const durationMs=Date.now()-state.connectedAt;stopTranscription();console.log("Twilio media stream stopped",{streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});pushEvent({type:"stream.media.stopped",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});return;}
  });
  server.addEventListener("close",(event)=>{state.turnGeneration+=1;stopTranscription();const durationMs=Date.now()-state.connectedAt;console.log("Twilio media websocket closed",{code:event.code,reason:event.reason,streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});pushEvent({type:"stream.websocket.closed",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,closeCode:String(event.code||""),mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});});
  server.addEventListener("error",()=>{state.turnGeneration+=1;stopTranscription();pushEvent({type:"stream.websocket.error",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId});});
  return new Response(null,{status:101,webSocket:client});
}
