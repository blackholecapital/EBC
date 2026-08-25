import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Bot, Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDollarSign, ExternalLink, FileSignature, FileText, Gauge,
  HardDrive, Headphones, LayoutDashboard, Mail, MessageSquare,
  Network, Phone, Search, ShieldCheck, Sparkles, Users, Zap
} from "lucide-react";
import "./App.css";
import "./Appointments.css";

type Stage = "New Inquiry" | "Qualified" | "Build Review" | "Quote Sent" | "Approved" | "Fabrication" | "Completed";
type EstimateLineItem = { quantity?:number; description?:string; unitPrice?:number; total?:number };
type EstimateQuote = {
  estimateNumber?:string; subject?:string; serviceName?:string; facilityCode?:string; facilityName?:string;
  createdAt?:string; validUntil?:string; validityDays?:number; currency?:string; lineItems?:EstimateLineItem[];
  monthlyTotal?:number; termMonths?:number; setupFeeStandard?:number; setupFeeDue?:number;
  promotion?:string; creditCardFeePercent?:number; demoSample?:boolean;
};
type Lead = {
  id:string; firstName:string; lastName:string; company?:string; phone?:string; email?:string;
  interest?:string; selectedProduct?:string; location?:string; stage:Stage; score?:number; source?:string;
  callStatus?:string; outreachStatus?:string; documentStatus?:string; docusignEnvelopeId?:string; agreementId?:string; signingShortUrl?:string;
  deliveryAt?:string; deliveryEnd?:string; deliveryStatus?:string; calendarEventId?:string; calendarEventUrl?:string; value?:number;
  estimateStatus?:string; estimateNumber?:string; estimateSentAt?:string; estimateValidUntil?:string; estimatedMonthlyTotal?:number;
  requirementsSummary?:string|string[]; estimateQuote?:EstimateQuote;
  initialLeadScore?:number; leadScoreBreakdown?:{key:string;label:string;points:number}[];
  appointmentStatus?:string; appointmentStart?:string; appointmentEnd?:string; appointmentTimeZone?:string;
  appointmentNotes?:string; appointmentRequestedAt?:string; appointmentUpdatedAt?:string; appointmentNotificationStatus?:string;
  appointmentRequestId?:string; appointmentRequestCount?:number;
};
type EbcEvent = { id:number|string; contactId?:string; callSid?:string; type:string; role?:string; text?:string; createdAt:number; payload?:any };
type DocumentArtifact = { id:string; kind:"estimate"|"agreement"; title:string; status:string; sentAt?:string; event?:EbcEvent };
type Conversation = { callSid?:string; contactId?:string; startedAt:number; endedAt:number; transcript:{role:string;text:string;at:number;type?:string}[]; events:EbcEvent[] };
type Tab = "Pipeline" | "Leads" | "Contracts" | "Installations" | "Appointments";
type View = "Operations" | "Accounts" | "Conversations" | "Analytics";
type LeadAction = "email" | "call" | "sms" | "document" | "calendar" | "approve-appointment";

const stages:Stage[]=["New Inquiry","Qualified","Build Review","Quote Sent","Approved","Fabrication","Completed"];
const products=["All EBC products","Power & Fuse Blocks","Plug-and-Play Wire Kits","Fan Kits","Speaker & LED Upgrades","Programming & Remote Assist","Custom Roofs & Enclosures","Compatibility & Technical Support","Universal Accessories","Custom Project"];
const DOC_BASE="https://ebc-concierge-worker.cryptocapitalgroupfl.workers.dev/docusign/document";
const EBC_TZ="America/New_York";
const demoLeads:Lead[]=[
  {id:"ebc-1",firstName:"Demo",lastName:"Lead 01",company:"Denago Nomad Owner",selectedProduct:"G2 Power Block",interest:"Power & Fuse Blocks",location:"Florida",stage:"New Inquiry",score:42,source:"everythingbuiltcustom.com",callStatus:"Not called",documentStatus:"Not sent",value:249.99},
  {id:"ebc-2",firstName:"Demo",lastName:"Lead 02",company:"Rover XL Custom Build",selectedProduct:"Front & Rear Fan Kit Rover",interest:"Fan Kits",location:"Tampa Bay",stage:"Build Review",score:88,source:"Referral",callStatus:"Completed",documentStatus:"Not sent",value:829.99},
  {id:"ebc-3",firstName:"Demo",lastName:"Lead 03",company:"Universal Audio Upgrade",selectedProduct:"Speaker Pods with DS18 & LED",interest:"Speaker & LED Upgrades",location:"Florida",stage:"Quote Sent",score:84,source:"Inbound call",callStatus:"Completed",documentStatus:"Sent",value:339.99},
  {id:"ebc-4",firstName:"Demo",lastName:"Lead 04",company:"Denago Performance Setup",selectedProduct:"Programming Cable & Remote Assist",interest:"Programming & Remote Assist",location:"United States / Remote",stage:"Approved",score:96,source:"Product page",callStatus:"Completed",documentStatus:"Signed",value:199.99},
  {id:"ebc-5",firstName:"Demo",lastName:"Lead 05",company:"Custom Roof Project",selectedProduct:"Slim Roof Rover XL",interest:"Custom Roofs & Enclosures",location:"Florida",stage:"Fabrication",score:91,source:"Custom project form",callStatus:"Completed",documentStatus:"Signed",deliveryAt:"2026-09-03T14:00:00-04:00",deliveryStatus:"Scheduled",value:449.99},
  {id:"ebc-6",firstName:"Demo",lastName:"Lead 06",company:"Nomad Plug-and-Play Build",selectedProduct:"Custom DS18 Build",interest:"Custom Project",location:"Central Florida",stage:"Completed",score:98,source:"Existing customer",callStatus:"Completed",documentStatus:"Completed",value:1599.99},
];

function zonedParts(value:any){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:EBC_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const p:Record<string,string>={}; for(const part of parts) if(part.type!=="literal")p[part.type]=part.value;
  return {year:Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour),minute:Number(p.minute)};
}
function formatEtTime(iso?:string){return iso?new Intl.DateTimeFormat("en-US",{timeZone:EBC_TZ,hour:"numeric",minute:"2-digit"}).format(new Date(iso)):"";}
function formatEtDateTime(iso?:string){return iso?new Intl.DateTimeFormat("en-US",{timeZone:EBC_TZ,weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(iso)):"";}
function formatEtMonthDay(iso?:string){return iso?new Intl.DateTimeFormat("en-US",{timeZone:EBC_TZ,month:"short",day:"numeric"}).format(new Date(iso)):"";}
function etInputValue(iso?:string){if(!iso)return"";const p=zonedParts(iso);return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}T${String(p.hour).padStart(2,"0")}:${String(p.minute).padStart(2,"0")}`;}
function etInputToIso(value:string){
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);if(!match)throw new Error("Choose a valid appointment date and time.");
  const [,ys,ms,ds,hs,mins]=match,guess=Date.UTC(+ys,+ms-1,+ds,+hs,+mins);let date=new Date(guess);
  for(let attempt=0;attempt<2;attempt+=1){const p=zonedParts(date),asUtc=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);date=new Date(guess-(asUtc-date.getTime()));}
  return date.toISOString();
}
function monthStart(value:any=new Date()){const p=zonedParts(value);return new Date(Date.UTC(p.year,p.month-1,1,12));}
function shiftMonth(value:Date,offset:number){return new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+offset,1,12));}
function calendarMonth(value:Date){
  const year=value.getUTCFullYear(),month=value.getUTCMonth()+1,firstDow=new Date(Date.UTC(year,month-1,1)).getUTCDay(),daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  return {year,month,cells:Array.from({length:42},(_,index)=>{const day=index-firstDow+1;return day>=1&&day<=daysInMonth?day:null;})};
}
function MonthControls({value,onChange}:{value:Date,onChange:(date:Date)=>void}){
  const first=monthStart(new Date()),options=Array.from({length:12},(_,index)=>shiftMonth(first,index));
  const key=`${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,"0")}`;
  if(!options.some(option=>`${option.getUTCFullYear()}-${String(option.getUTCMonth()+1).padStart(2,"0")}`===key))options.unshift(value);
  return <div className="month-controls"><button aria-label="Previous month" onClick={()=>onChange(shiftMonth(value,-1))}><ChevronLeft size={16}/></button><select aria-label="Calendar month" value={key} onChange={event=>{const [year,month]=event.target.value.split("-").map(Number);onChange(new Date(Date.UTC(year,month-1,1,12)));}}>{options.map(option=>{const optionKey=`${option.getUTCFullYear()}-${String(option.getUTCMonth()+1).padStart(2,"0")}`;return <option value={optionKey} key={optionKey}>{new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"long",year:"numeric"}).format(option)}</option>;})}</select><button aria-label="Next month" onClick={()=>onChange(shiftMonth(value,1))}><ChevronRight size={16}/></button></div>;
}
async function postJson(path:string,body:any){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok||data?.ok===false)throw new Error(data?.error||`Request failed (${r.status})`);return data;}

function isWorkflowEvent(event:EbcEvent){
  return /^(lead\.created|product\.interest\.|email\.(sent|failed)|sms\.(sent|failed)|call\.(requested|created|initiated|ringing|answered|in-progress|completed|failed)|estimate\.(sent|failed)|sales\.(handoff|appointment)\.|docusign\.|delivery\.|buddy\.estimate\.)/i.test(event.type);
}
function workflowTitle(event:EbcEvent){
  const type=event.type.toLowerCase(),p=event.payload||{};
  if(type==="email.sent")return p.messageType==="ebc-preliminary-estimate"?"Proposal email delivered":"Welcome email delivered";
  if(type==="email.failed")return "Email delivery failed";
  if(type==="estimate.sent")return "Estimate created and sent";
  if(type==="estimate.failed"||type==="buddy.estimate.failed")return "Estimate workflow failed";
  if(type==="sales.handoff.created")return "Sales-team handoff created";
  if(type==="product.interest.selected")return "Recommended product recorded";
  if(type==="sales.appointment.requested")return "Sales appointment requested";
  if(type==="sales.appointment.approved")return "Sales appointment approved";
  if(type==="sales.appointment.rescheduled")return "Sales appointment rescheduled";
  if(type==="docusign.sent")return "Contract sent for signature";
  if(type.includes("docusign")&&/signed|completed/.test(type))return "Contract signed";
  if(type==="delivery.scheduled")return "Build or installation scheduled";
  if(type==="call.completed")return "AI call completed";
  if(type==="call.in-progress"||type==="call.answered")return "AI call connected";
  if(type==="call.created"||type==="call.requested")return "AI call requested";
  if(type.startsWith("sms.sent"))return "SMS delivered";
  if(type==="lead.created")return "Lead captured";
  return event.type.replaceAll("."," ").replace(/\b\w/g,c=>c.toUpperCase());
}
function workflowDescription(event:EbcEvent){
  const p=event.payload||{};
  if(event.type==="email.sent")return p.subject||`Sent to ${p.to||"customer"}`;
  if(event.type==="estimate.sent")return [p.estimateNumber,p.productName,p.monthlyTotal?Number(p.monthlyTotal).toLocaleString("en-US",{style:"currency",currency:"USD"}):""].filter(Boolean).join(" · ");
  if(event.type.startsWith("call."))return p.status?`Status: ${p.status}`:(event.callSid||"Voice workflow update");
  return event.text||p.message||p.reason||p.productName||p.label||p.appointmentStart||p.deliveryAt||"Workflow event recorded";
}
function latestWorkflowEvent(events:EbcEvent[]){return [...events].filter(isWorkflowEvent).sort((a,b)=>b.createdAt-a.createdAt)[0];}
function workflowDetails(event:EbcEvent){
  const p=event.payload||{},rows:[string,string][]=[];
  const add=(label:string,value:any)=>{if(value!==undefined&&value!==null&&String(value).trim())rows.push([label,String(value)]);};
  add("Recipient",p.to);add("Subject",p.subject);add("Email type",p.messageType);add("Provider",p.provider);add("Provider message ID",p.messageId);
  add("Estimate",p.estimateNumber);add("Product / project",p.productName);add("Estimated total",p.monthlyTotal?Number(p.monthlyTotal).toLocaleString("en-US",{style:"currency",currency:"USD"}):"");
  add("Requirements",p.requirements);add("Reason",p.reason);add("Call SID",event.callSid||p.callSid);add("Status",p.status);add("Scheduled for",p.deliveryAt);
  add("Appointment",p.label||p.appointmentStart);add("Appointment status",p.appointmentStatus);add("Notes",p.notes);
  add("Recorded message",event.text||p.message);return rows;
}

function documentsForLead(lead:Lead,events:EbcEvent[]):DocumentArtifact[]{
  const estimateEvent=events.find(event=>event.type==="estimate.sent");
  const estimateEmail=events.find(event=>event.type==="email.sent"&&event.payload?.messageType==="ebc-preliminary-estimate");
  const docusignEvent=events.find(event=>event.type==="docusign.sent"||(/docusign/.test(event.type)&&/signed|completed/.test(event.type)));
  const documents:DocumentArtifact[]=[];
  const estimateNumber=lead.estimateNumber||estimateEvent?.payload?.estimateNumber;
  if(estimateNumber||estimateEmail){
    const sentAt=lead.estimateSentAt||(estimateEvent?.createdAt?new Date(estimateEvent.createdAt).toISOString():estimateEmail?.createdAt?new Date(estimateEmail.createdAt).toISOString():"");
    documents.push({id:`estimate-${estimateNumber||lead.id}`,kind:"estimate",title:`Project Estimate${estimateNumber?` ${estimateNumber}`:""}`,status:estimateEmail?"Emailed":"Sent",sentAt,event:estimateEvent||estimateEmail});
  }
  if(lead.docusignEnvelopeId||lead.agreementId||docusignEvent){
    documents.push({id:`agreement-${lead.docusignEnvelopeId||lead.agreementId||lead.id}`,kind:"agreement",title:"Custom Project Agreement",status:lead.documentStatus||"Sent",sentAt:docusignEvent?.createdAt?new Date(docusignEvent.createdAt).toISOString():"",event:docusignEvent});
  }
  return documents;
}

function money(value:any,currency="USD"){return Number(value||0).toLocaleString("en-US",{style:"currency",currency});}

function inferStage(d:any):Stage {
  const raw=String(d?.stage||d?.status||"");
  if(raw==="New Inquiry"||raw==="New Lead")return "New Inquiry";
  if(stages.includes(raw as Stage))return raw as Stage;
  if(raw==="Closed"||String(d?.deliveryStatus||"").toLowerCase()==="completed")return "Completed";
  if(raw==="Scheduled"||d?.deliveryAt||["scheduled","fabrication","provisioning"].includes(String(d?.deliveryStatus||"").toLowerCase()))return "Fabrication";
  if(["signed","approved"].includes(String(d?.documentStatus||"").toLowerCase()))return "Approved";
  if(raw==="Estimate Sent"||d?.estimateNumber||String(d?.estimateStatus||"").toLowerCase()==="sent")return "Quote Sent";
  if(d?.docusignEnvelopeId||String(d?.documentStatus||"").toLowerCase()==="sent"||raw==="Docs Sent")return "Quote Sent";
  if(raw==="Engaged"||d?.selectedProduct)return "Build Review";
  const call=String(d?.callStatus||"").toLowerCase();
  if(call.includes("completed")||call.includes("answered")||call.includes("connected"))return "Qualified";
  if(raw==="Contacted"||d?.outreachStatus==="Sent"||call.includes("requested")||call.includes("ringing"))return "Qualified";
  return "New Inquiry";
}
function normalizeContact(raw:any,i:number):Lead {
  let d=raw?.data??raw;if(typeof d==="string"){try{d=JSON.parse(d);}catch{d=raw;}}
  return {
    id:String(d?.id||raw?.id||`lead-${i}`),firstName:d?.firstName||d?.first_name||d?.name?.split?.(" ")?.[0]||"Guest",
    lastName:d?.lastName||d?.last_name||d?.name?.split?.(" ")?.slice?.(1)?.join?.(" ")||"",company:d?.company||d?.organization||d?.businessName||"",
    phone:d?.phone||"",email:d?.email||"",interest:d?.interest||d?.product||d?.lookingFor||"Custom Project",selectedProduct:d?.selectedProduct||d?.selected_product||"",
    location:d?.location||d?.state||d?.area||"Unassigned",stage:inferStage(d),score:Number(d?.leadScore||d?.score||70),source:d?.source||"everythingbuiltcustom.com",
    callStatus:d?.callStatus||d?.call_status||"Not called",outreachStatus:d?.outreachStatus||"",documentStatus:d?.documentStatus||d?.document_status||"Not sent",
    docusignEnvelopeId:d?.docusignEnvelopeId||d?.docusign_envelope_id||"",agreementId:d?.agreementId||d?.agreement_id||"",signingShortUrl:d?.signingShortUrl||"",
    deliveryAt:d?.deliveryAt||d?.delivery_at,deliveryEnd:d?.deliveryEnd||d?.delivery_end,
    deliveryStatus:d?.deliveryStatus||d?.delivery_status||(d?.deliveryAt?"Scheduled":"Not scheduled"),calendarEventId:d?.calendarEventId||d?.calendar_event_id||"",
    calendarEventUrl:d?.calendarEventUrl||d?.calendar_event_url||"",value:Number(d?.value||d?.amount||0),
    estimateStatus:d?.estimateStatus||d?.estimate_status||"",estimateNumber:d?.estimateNumber||d?.estimate_number||"",
    estimateSentAt:d?.estimateSentAt||d?.estimate_sent_at||"",estimateValidUntil:d?.estimateValidUntil||d?.estimate_valid_until||"",
    estimatedMonthlyTotal:Number(d?.estimatedMonthlyTotal||d?.estimated_monthly_total||0),requirementsSummary:d?.requirementsSummary||d?.requirements_summary||"",
    estimateQuote:d?.estimateQuote||d?.estimate_quote||undefined,
    initialLeadScore:Number(d?.initialLeadScore||0),leadScoreBreakdown:Array.isArray(d?.leadScoreBreakdown)?d.leadScoreBreakdown:[],
    appointmentStatus:d?.appointmentStatus||"",appointmentStart:d?.appointmentStart||"",appointmentEnd:d?.appointmentEnd||"",
    appointmentTimeZone:d?.appointmentTimeZone||EBC_TZ,appointmentNotes:d?.appointmentNotes||"",
    appointmentRequestedAt:d?.appointmentRequestedAt||"",appointmentUpdatedAt:d?.appointmentUpdatedAt||"",
    appointmentNotificationStatus:d?.appointmentNotificationStatus||"",appointmentRequestId:d?.appointmentRequestId||"",
    appointmentRequestCount:Number(d?.appointmentRequestCount||0),
  };
}

export default function App(){
  const [view,setView]=useState<View>("Operations"),[tab,setTab]=useState<Tab>("Pipeline"),[leads,setLeads]=useState<Lead[]>(demoLeads),[selected,setSelected]=useState<Lead>(demoLeads[0]),[live,setLive]=useState(false);
  const [conversations,setConversations]=useState<Conversation[]>([]),[events,setEvents]=useState<EbcEvent[]>([]),[selectedCall,setSelectedCall]=useState<Conversation|null>(null);
  const [documentView,setDocumentView]=useState<{lead:Lead;document:DocumentArtifact}|null>(null);

  async function loadLeads(){return fetch("/api/contacts").then(r=>r.ok?r.json():Promise.reject()).then(payload=>{const rows=Array.isArray(payload)?payload:payload?.contacts||payload?.rows||payload?.data||[];if(Array.isArray(rows)&&rows.length){const mapped=rows.map(normalizeContact);setLeads(mapped);setSelected(current=>mapped.find((l:Lead)=>l.id===current?.id)||mapped[0]);setLive(true);}}).catch(()=>setLive(false));}
  useEffect(()=>{loadLeads();const timer=window.setInterval(loadLeads,5000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{const load=()=>fetch("/api/buddy-events?limit=2000").then(r=>r.ok?r.json():Promise.reject()).then(p=>{const data=p?.data||{};setConversations(data.conversations||[]);setEvents(data.events||[]);setSelectedCall(current=>current?((data.conversations||[]).find((c:Conversation)=>c.callSid===current.callSid)||current):((data.conversations||[])[0]||null));}).catch(()=>{});load();const timer=window.setInterval(load,8000);return()=>clearInterval(timer);},[]);

  const metrics=useMemo(()=>{const completed=leads.filter(l=>l.stage==="Completed").length,qualified=leads.filter(l=>l.stage!=="New Inquiry").length,inBuild=leads.filter(l=>["Approved","Fabrication"].includes(l.stage)).length,pipeline=leads.reduce((sum,l)=>sum+(l.value||0),0);return{total:leads.length,qualified,inBuild,completed,pipeline};},[leads]);
  const customerFor=(id?:string)=>leads.find(l=>l.id===id);
  const eventsFor=(id?:string)=>events.filter(event=>event.contactId===id);

  async function act(lead:Lead,action:LeadAction){
    setSelected(lead);
    try{
      if(action==="email"){if(!lead.email)throw new Error("This prospect has no email address.");window.location.href=`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent("Your Everything Built Custom project")}`;return;}
      if(action==="call"){if(!lead.phone)throw new Error("This prospect has no phone number.");await postJson("/api/calls",{contactId:lead.id});window.alert(`EBC AI is calling ${lead.firstName} now.`);return;}
      if(action==="sms"){if(!lead.phone)throw new Error("This prospect has no phone number.");const body=window.prompt(`Text ${lead.firstName}:`,"Hi, this is Everything Built Custom. How can our custom cart team help with your build?");if(!body?.trim())return;await postJson("/api/inbox",{contactId:lead.id,channel:"sms",body:body.trim()});window.alert("SMS sent.");return;}
      if(action==="document"){
        const documents=documentsForLead(lead,eventsFor(lead.id));
        if(documents.length){
          setView("Operations");setTab("Contracts");
          const estimate=documents.find(document=>document.kind==="estimate");
          if(estimate)setDocumentView({lead,document:estimate});
          else window.open(`${DOC_BASE}/${encodeURIComponent(lead.id)}`,"_blank","noopener,noreferrer");
          return;
        }
        const service=window.prompt("Service for the Everything Built Custom agreement:",lead.selectedProduct||lead.interest||"");if(!service?.trim())return;
        await postJson("/api/manual-agreement",{contactId:lead.id,productName:service.trim()});window.alert("Everything Built Custom agreement sent by text and email.");return;
      }
      if(action==="calendar"){setView("Operations");setTab("Appointments");return;}
      if(action==="approve-appointment"){
        if(!lead.appointmentStart)throw new Error("This request does not include a proposed appointment time.");
        const result=await postJson("/api/appointments",{contactId:lead.id,action:"approve",startIso:lead.appointmentStart,timeZone:lead.appointmentTimeZone||EBC_TZ,notes:lead.appointmentNotes||lead.requirementsSummary||"Sales consultation requested by customer"});
        await loadLeads();
        const status=result?.data?.appointment?.notificationStatus;
        window.alert(status==="Sent"?"Appointment approved and customer confirmation sent.":`Appointment approved. Customer notification status: ${status||"not confirmed"}.`);
      }
    }catch(error:any){window.alert(error?.message||"That action failed.");}
  }

  return <div className="ebc-app">
    <aside className="side-nav">
      <EbcLogo/>
      <nav>
        <button onClick={()=>setView("Operations")} className={view==="Operations"?"nav-item active":"nav-item"}><LayoutDashboard size={19}/> Operations</button>
        <button onClick={()=>setView("Accounts")} className={view==="Accounts"?"nav-item active":"nav-item"}><Building2 size={19}/> Customers</button>
        <button onClick={()=>setView("Conversations")} className={view==="Conversations"?"nav-item active":"nav-item"}><Headphones size={19}/> Conversations</button>
        <button onClick={()=>setView("Analytics")} className={view==="Analytics"?"nav-item active":"nav-item"}><BarChart3 size={19}/> Analytics</button>
        <a href="/lead/" className="nav-item" style={{textDecoration:"none"}}><ExternalLink size={19}/> Lead Demo</a>
        <a href="https://ebc-dashboard-worker.cryptocapitalgroupfl.workers.dev/#dashboard" target="_blank" rel="noreferrer" className="nav-item" style={{textDecoration:"none"}}><ExternalLink size={19}/> EBC Corporate Backend</a>
      </nav>
      <div className="ai-side-card"><span><Sparkles size={14}/> GO CUSTOM</span><strong>Custom Project Concierge</strong><p>Qualify the cart, parts, fitment, finish, install needs, and timeline before the team calls.</p><button onClick={()=>{setView("Operations");setTab("Leads");}}>View leads <ChevronRight size={14}/></button></div>
      <div className="side-status"><span className={live?"dot live":"dot"}/>{live?"Live EBC customer data":"EBC demo data"}<small>AI call center online</small></div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div><span className="eyebrow">EVERYTHING BUILT CUSTOM · CART & ATV BUILDS</span><h1>AI Call Center</h1><p>From first question to a completed custom build.</p></div><div className="top-actions"><div className="search"><Search size={17}/><span>Search customers, carts, products, calls...</span></div><div className="scope-pill"><Building2 size={13}/> EBC · All channels</div><div className="system-pill"><span/> Systems online</div><div className="avatar">EBC</div></div></header>
      <section className="kpis"><Kpi label="Open Opportunities" value={metrics.total} icon={<Users/>}/><Kpi label="Qualified" value={metrics.qualified} icon={<Gauge/>}/><Kpi label="Approved / In Build" value={metrics.inBuild} icon={<FileSignature/>}/><Kpi label="Completed" value={metrics.completed} icon={<CheckCircle2/>}/><Kpi label="Pipeline Value" value={metrics.pipeline.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})} icon={<CircleDollarSign/>}/></section>

      {view==="Operations"&&<><div className="tabbar">{(["Pipeline","Leads","Contracts","Installations","Appointments"] as Tab[]).map(t=><button key={t} onClick={()=>setTab(t)} className={tab===t?"tab active":"tab"}>{t}</button>)}</div><div className="content-shell"><section className="content-main">{tab==="Pipeline"&&<Pipeline leads={leads} events={events} onSelect={setSelected} onAction={act}/>} {tab==="Leads"&&<Leads leads={leads} events={events} onSelect={setSelected} onAction={act}/>} {tab==="Contracts"&&<Contracts leads={leads} events={events} onSelect={setSelected} onView={(lead,document)=>setDocumentView({lead,document})}/>} {tab==="Installations"&&<Installations leads={leads} onSelect={setSelected}/>} {tab==="Appointments"&&<Appointments leads={leads} onSelect={setSelected} onChanged={loadLeads}/>}</section><LeadDetail lead={selected} events={eventsFor(selected?.id)} onAction={act}/></div></>}
      {view==="Accounts"&&<div className="content-shell accounts-shell"><section className="content-main"><div className="table-title"><div><h2>Everything Built Custom Customers</h2><p>Live prospects, returning customers, and custom-build opportunities.</p></div></div><Leads leads={leads} events={events} onSelect={setSelected} onAction={act} compact/></section><LeadDetail lead={selected} events={eventsFor(selected?.id)} onAction={act}/></div>}
      {view==="Conversations"&&<ConversationsView conversations={conversations} selected={selectedCall} onSelect={setSelectedCall} customerFor={customerFor}/>}
      {view==="Analytics"&&<AnalyticsView events={events}/>}
    </main>
    {documentView&&<DocumentViewer lead={documentView.lead} document={documentView.document} onClose={()=>setDocumentView(null)}/>}
  </div>;
}

function EbcLogo(){return <div className="brand ebc-wordmark"><img src="https://everythingbuiltcustom.com/wp-content/uploads/2025/10/ebd-logo-header-color.png" alt="Everything Built Custom"/><div><strong><b>EBC</b> CUSTOM</strong><span>CART & ATV ACCESSORIES</span></div></div>}
function Kpi({label,value,icon}:{label:string,value:any,icon:any}){return <div className="kpi"><div><span>{label}</span><strong>{value}</strong></div><div className="kpi-icon">{icon}</div></div>}
function Pipeline({leads,events,onSelect,onAction}:{leads:Lead[],events:EbcEvent[],onSelect:(l:Lead)=>void,onAction:(l:Lead,a:LeadAction)=>void}){return <div className="pipeline">{stages.map(stage=>{const items=leads.filter(l=>l.stage===stage);return <div className={`stage stage-${stage.toLowerCase().replaceAll(" ","-")}`} key={stage}><div className="stage-head"><div><strong>{stage}</strong><span>{items.length}</span></div><b>{items.reduce((s,l)=>s+(l.value||0),0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}</b></div><div className="stage-body">{items.length?items.map(l=><LeadCard key={l.id} lead={l} events={events.filter(e=>e.contactId===l.id)} onClick={()=>onSelect(l)} onAction={onAction}/>):<div className="empty-stage"><Network size={26}/><span>No opportunities</span></div>}</div></div>})}</div>}
function Leads({leads,events,onSelect,onAction,compact=false}:{leads:Lead[],events:EbcEvent[],onSelect:(l:Lead)=>void,onAction:(l:Lead,a:LeadAction)=>void,compact?:boolean}){const [product,setProduct]=useState(products[0]);const visible=product===products[0]?leads:leads.filter(l=>(l.interest||l.selectedProduct)===product);return <div className="leads-view"><CustomProjectBanner/><div className="lead-toolbar"><div><span className="eyebrow">OPPORTUNITY DIRECTORY</span><h2>Cart & ATV Leads</h2></div><label>Product <select value={product} onChange={e=>setProduct(e.target.value)}>{products.map(item=><option key={item}>{item}</option>)}</select></label></div><div className={compact?"lead-grid compact":"lead-grid"}>{visible.map(l=><LeadCard key={l.id} lead={l} events={events.filter(e=>e.contactId===l.id)} onClick={()=>onSelect(l)} onAction={onAction} large/>)}</div>{!visible.length&&<div className="empty-results">No leads for this product yet.</div>}</div>}
function CustomProjectBanner(){return <div className="ai-banner"><div className="ai-orb"><Bot size={31}/></div><div><span className="banner-kicker"><Sparkles size={13}/> CAN’T FIND IT?</span><h2>Go custom.</h2><p>EBC’s AI concierge captures the cart make, model, year, desired accessories, wiring and fitment details, color, installation needs, and project timing before routing the build to the team.</p><div className="feature-chips"><span><Phone size={13}/> 24/7 Intake</span><span><Zap size={13}/> Instant Follow-up</span><span><CalendarDays size={13}/> Build Scheduling</span><span><Network size={13}/> CRM Sync</span></div></div><div className="banner-cta"><small>CUSTOM PROJECTS</small><strong>Built for your cart</strong><span>Wire kits, fans, audio, lighting & more</span><ChevronRight/></div></div>}
function LeadCard({lead,events,onClick,onAction,large=false}:{lead:Lead,events:EbcEvent[],onClick:()=>void,onAction:(l:Lead,a:LeadAction)=>void,large?:boolean}){
  const run=(event:any,action:LeadAction)=>{event.stopPropagation();onAction(lead,action);};
  const latest=latestWorkflowEvent(events),appointmentRequested=lead.appointmentStatus==="Requested";
  return <div className={`${large?"lead-card large":"lead-card"} card-stage-${lead.stage.toLowerCase().replaceAll(" ","-")}`} onClick={onClick} role="button" tabIndex={0}>
    <div className="lead-card-top"><span className="initials">{lead.firstName[0]}{lead.lastName?.[0]||""}</span><span className="score">{lead.score} SCORE</span></div>
    <strong>{lead.company||`${lead.firstName} ${lead.lastName}`}</strong>{lead.company&&<small className="contact-name">{lead.firstName} {lead.lastName}</small>}
    <span className="interest">{lead.selectedProduct||lead.interest}</span><div className="lead-tags"><span>{lead.location}</span><span>{lead.stage}</span></div>
    {appointmentRequested&&<div className="appointment-alert"><CalendarDays size={15}/><span><b>Appointment requested</b><small>{lead.appointmentStart?`${formatEtDateTime(lead.appointmentStart)} · Approval required`:"Time needed · Approval required"}</small></span>{lead.appointmentStart&&<button onClick={event=>run(event,"approve-appointment")}>Approve</button>}</div>}
    {latest&&<div className="lead-workflow"><CheckCircle2 size={12}/><span><b>{workflowTitle(latest)}</b><small>{new Date(latest.createdAt).toLocaleString()}</small></span></div>}
    <div className="contact-lines"><span><Phone size={12}/>{lead.phone||"No phone"}</span><span><Mail size={12}/>{lead.email||"No email"}</span></div>
    <div className="lead-value">{(lead.value||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}<small> opportunity</small></div>
    <div className="lead-actions"><button title="Email prospect" onClick={event=>run(event,"email")}><Mail size={15}/></button><button title="Start EBC AI call" onClick={event=>run(event,"call")}><Phone size={15}/></button><button title="Send SMS" onClick={event=>run(event,"sms")}><MessageSquare size={15}/></button><button title="Open or send proposal" onClick={event=>run(event,"document")}><FileText size={15}/></button><button title="Sales appointments" onClick={event=>run(event,"calendar")}><CalendarDays size={15}/></button></div>
  </div>;
}

function Contracts({leads,events,onSelect,onView}:{leads:Lead[],events:EbcEvent[],onSelect:(l:Lead)=>void,onView:(l:Lead,d:DocumentArtifact)=>void}){
  const rows=leads.flatMap(lead=>documentsForLead(lead,events.filter(event=>event.contactId===lead.id)).map(document=>({lead,document})));
  return <div className="table-card"><div className="table-title"><div><h2>Quotes & Contracts</h2><p>Every estimate, proposal and project agreement sent through the EBC workflow.</p></div><span className="document-count">{rows.length} document{rows.length===1?"":"s"}</span></div><div className="doc-table head"><span>Account</span><span>Document</span><span>EBC Product</span><span>Status</span><span>Action</span></div>{rows.length?rows.map(({lead,document})=><div className="doc-table" key={`${lead.id}-${document.id}`}><span><b>{lead.company||`${lead.firstName} ${lead.lastName}`}</b><small>{document.kind==="estimate"?lead.estimateNumber:lead.agreementId||lead.email||lead.phone}</small></span><span><b>{document.title}</b><small>{document.sentAt?`Sent ${formatEtDateTime(document.sentAt)}`:"Workflow document"}</small></span><span>{lead.selectedProduct||lead.interest}</span><span><Status value={document.status}/></span><span>{document.kind==="agreement"?<a className="link" href={`${DOC_BASE}/${encodeURIComponent(lead.id)}`} target="_blank" rel="noreferrer" onClick={()=>onSelect(lead)}>View PDF <ExternalLink size={14}/></a>:<button className="document-link" onClick={()=>{onSelect(lead);onView(lead,document);}}>View estimate <FileText size={14}/></button>}</span></div>):<div className="empty-documents"><FileText size={30}/><b>No workflow documents yet</b><span>Sent estimates and agreements will appear here automatically.</span></div>}</div>
}

function DocumentViewer({lead,document,onClose}:{lead:Lead,document:DocumentArtifact,onClose:()=>void}){
  const quote=lead.estimateQuote||{};const currency=quote.currency||"USD";const lines=Array.isArray(quote.lineItems)?quote.lineItems:[];
  const number=lead.estimateNumber||quote.estimateNumber||document.event?.payload?.estimateNumber||"EBC Estimate";
  const total=Number(quote.monthlyTotal||lead.estimatedMonthlyTotal||document.event?.payload?.monthlyTotal||0);
  const requirements=Array.isArray(lead.requirementsSummary)?lead.requirementsSummary.join(" "):lead.requirementsSummary||document.event?.payload?.requirements||"Not specified";
  return <div className="document-modal" role="dialog" aria-modal="true" aria-label={`${number} estimate`} onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><article className="document-sheet"><div className="document-toolbar"><span>Sent workflow document</span><div><button onClick={()=>window.print()}>Print / Save PDF</button><button className="close-document" onClick={onClose}>Close</button></div></div><header className="estimate-header"><div><strong>EBC</strong><b> CUSTOM</b><small>CART & ATV ACCESSORIES</small></div><div><span>Project Estimate</span><b>{number}</b></div></header>{quote.demoSample&&<div className="estimate-demo">DEMO SAMPLE ESTIMATE — subject to compatibility review and final approval.</div>}<div className="estimate-meta"><div><span>Estimate #</span><b>{number}</b></div><div><span>Subject</span><b>{quote.subject||quote.serviceName||lead.selectedProduct||lead.interest}</b></div><div><span>Created</span><b>{formatEtMonthDay(quote.createdAt||lead.estimateSentAt||document.sentAt)}</b></div><div><span>Valid until</span><b>{formatEtMonthDay(quote.validUntil||lead.estimateValidUntil)}</b></div></div><div className="estimate-parties"><div><span>Customer</span><b>{lead.company||`${lead.firstName} ${lead.lastName}`}</b><p>{lead.firstName} {lead.lastName}<br/>{lead.email}<br/>{lead.phone}</p></div><div><span>Project location</span><b>{quote.facilityCode||lead.location}</b><p>{quote.facilityName||lead.location}<br/>{quote.serviceName||lead.selectedProduct||lead.interest}</p></div></div><section className="estimate-requirements"><span>Build requirements discussed</span><p>{String(requirements)}</p></section><div className="estimate-lines"><div className="estimate-line head"><span>Qty</span><span>Description</span><span>Unit price</span><span>Total</span></div>{lines.length?lines.map((line,index)=><div className="estimate-line" key={`${line.description}-${index}`}><span>{line.quantity||1}</span><span>{line.description}</span><span>{money(line.unitPrice,currency)}</span><span>{money(line.total,currency)}</span></div>):<div className="estimate-line"><span>1</span><span>{quote.serviceName||lead.selectedProduct||lead.interest}</span><span>{money(total,currency)}</span><span>{money(total,currency)}</span></div>}<div className="estimate-total"><span>Estimated project total</span><b>{money(total,currency)}</b></div></div><div className="estimate-terms"><div><span>Build type</span><b>Custom to order</b></div><div><span>Parts / setup</span><b>{money(quote.setupFeeStandard||0,currency)}</b></div><div><span>Due now</span><b>{money(quote.setupFeeDue||0,currency)}</b></div><div><span>Promotion</span><b>{quote.promotion||"None"}</b></div><div><span>Card fee</span><b>{quote.creditCardFeePercent||3.5}%</b></div></div><footer><p>This estimate is based on the information available during the call and remains subject to cart compatibility, final configuration, shipping, taxes, availability, and approval by Everything Built Custom.</p><small>Emailed to {lead.email||"customer"}{document.sentAt?` · ${formatEtDateTime(document.sentAt)}`:""}</small></footer></article></div>
}

function Installations({leads,onSelect}:{leads:Lead[],onSelect:(l:Lead)=>void}){
  const installs=leads.filter(l=>l.deliveryAt).sort((a,b)=>new Date(a.deliveryAt!).getTime()-new Date(b.deliveryAt!).getTime());
  const [cursor,setCursor]=useState(()=>monthStart(new Date()));const {year,month,cells}=calendarMonth(cursor);
  return <div className="delivery-layout"><div className="calendar-card"><div className="table-title"><div><h2>Build & Installation Calendar</h2><p>Fitment reviews, fabrication, installs, remote assists, and pickups · Eastern Time</p></div><MonthControls value={cursor} onChange={setCursor}/></div><div className="calendar-grid">{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=><div className="dow" key={d}>{d}</div>)}{cells.map((day,i)=>{const ds=day?installs.filter(l=>{const p=zonedParts(l.deliveryAt!);return p.year===year&&p.month===month&&p.day===day;}):[];return <div className={day?"day":"day muted"} key={i}><b>{day||""}</b>{ds.map(l=><button className="delivery-pill" onClick={()=>onSelect(l)} key={l.id}>{formatEtTime(l.deliveryAt)} · {l.company||l.firstName}</button>)}</div>})}</div></div><div className="delivery-side"><h3>Upcoming builds</h3>{installs.length?installs.map(l=><button className="delivery-row" onClick={()=>onSelect(l)} key={l.id}><div className="date-box"><b>{zonedParts(l.deliveryAt!).day}</b><span>{new Intl.DateTimeFormat("en-US",{timeZone:EBC_TZ,month:"short"}).format(new Date(l.deliveryAt!)).toUpperCase()}</span></div><div><strong>{l.company||`${l.firstName} ${l.lastName}`}</strong><span>{l.selectedProduct||l.interest}</span><small>{formatEtTime(l.deliveryAt)} ET · {l.location}</small></div></button>):<p>No builds scheduled.</p>}</div></div>
}

function Appointments({leads,onSelect,onChanged}:{leads:Lead[],onSelect:(l:Lead)=>void,onChanged:()=>Promise<any>}){
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[busy,setBusy]=useState(""),[cursor,setCursor]=useState(()=>monthStart(new Date()));
  const appointments=leads.filter(lead=>lead.appointmentStatus||lead.appointmentStart).sort((a,b)=>new Date(a.appointmentStart||a.appointmentRequestedAt||0).getTime()-new Date(b.appointmentStart||b.appointmentRequestedAt||0).getTime());
  const scheduled=appointments.filter(lead=>lead.appointmentStart),{year,month,cells}=calendarMonth(cursor);
  async function updateAppointment(lead:Lead,action:"approve"|"reschedule"){
    const input=drafts[lead.id]||etInputValue(lead.appointmentStart);if(!input){window.alert("Choose a date and time first.");return;}setBusy(`${lead.id}-${action}`);
    try{
      const result=await postJson("/api/appointments",{contactId:lead.id,action,startIso:etInputToIso(input),timeZone:EBC_TZ,notes:lead.appointmentNotes||lead.requirementsSummary||"Sales consultation requested by customer"});
      await onChanged();
      const notification=result?.data?.appointment?.notificationStatus;
      const updated=action==="approve"?"Appointment approved.":"Appointment rescheduled.";
      window.alert(notification==="Sent"?`${updated} Customer confirmation sent.`:`${updated} Customer notification status: ${notification||"not confirmed"}.`);
    }
    catch(error:any){window.alert(error?.message||"Appointment update failed.");}finally{setBusy("");}
  }
  return <div className="appointment-layout"><div className="calendar-card"><div className="table-title"><div><h2>Sales Appointments</h2><p>Customer-requested consultations · Eastern Time</p></div><MonthControls value={cursor} onChange={setCursor}/></div><div className="calendar-grid">{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(day=><div className="dow" key={day}>{day}</div>)}{cells.map((day,index)=>{const rows=day?scheduled.filter(lead=>{const p=zonedParts(lead.appointmentStart!);return p.year===year&&p.month===month&&p.day===day;}):[];return <div className={day?"day":"day muted"} key={index}><b>{day||""}</b>{rows.map(lead=><button className={`appointment-pill ${lead.appointmentStatus==="Requested"?"requested":""}`} onClick={()=>onSelect(lead)} key={lead.id}>{formatEtTime(lead.appointmentStart)} · {lead.company||lead.firstName}<small>{lead.appointmentStatus==="Requested"?"Approval required":lead.appointmentStatus}</small></button>)}</div>})}</div></div><div className="appointment-queue"><div className="table-title"><div><h2>Approval Queue</h2><p>{appointments.filter(lead=>lead.appointmentStatus==="Requested").length} awaiting review</p></div></div>{appointments.length?appointments.map(lead=>{const input=drafts[lead.id]??etInputValue(lead.appointmentStart),requested=lead.appointmentStatus==="Requested";return <article className="appointment-card" key={lead.id} onClick={()=>onSelect(lead)}><div className="appointment-card-head"><div><strong>{lead.company||`${lead.firstName} ${lead.lastName}`}</strong><span>{lead.selectedProduct||lead.interest}</span></div><Status value={lead.appointmentStatus||"Requested"}/></div><p>{lead.appointmentNotes||lead.requirementsSummary||"Customer requested a sales consultation."}</p><label>Appointment time (Eastern)<input type="datetime-local" value={input} onChange={event=>setDrafts(current=>({...current,[lead.id]:event.target.value}))} onClick={event=>event.stopPropagation()}/></label><div className="appointment-meta"><span>{lead.appointmentRequestedAt?`Requested ${formatEtDateTime(lead.appointmentRequestedAt)}`:"Customer request"}</span><span>Notification: {lead.appointmentNotificationStatus||"Pending"}</span></div><div className="appointment-actions"><button disabled={Boolean(busy)} onClick={event=>{event.stopPropagation();updateAppointment(lead,"approve");}}>{busy===`${lead.id}-approve`?"Approving…":requested?"Approve time":"Confirm time"}</button><button className="secondary" disabled={Boolean(busy)} onClick={event=>{event.stopPropagation();updateAppointment(lead,"reschedule");}}>{busy===`${lead.id}-reschedule`?"Rescheduling…":"Reschedule & notify"}</button></div></article>}):<div className="empty-documents"><CalendarDays size={30}/><b>No sales appointments yet</b><span>Requests captured by EBC AI will appear here for approval.</span></div>}</div></div>;
}

function ConversationsView({conversations,selected,onSelect,customerFor}:{conversations:Conversation[],selected:Conversation|null,onSelect:(c:Conversation)=>void,customerFor:(id?:string)=>Lead|undefined}){return <div className="conversation-layout"><div className="table-card conversation-list"><div className="table-title"><div><h2>AI Voice Conversations</h2><p>{conversations.length} captured Everything Built Custom calls</p></div></div>{conversations.length?conversations.map(c=>{const lead=customerFor(c.contactId);return <button key={c.callSid||`${c.contactId}-${c.startedAt}`} onClick={()=>onSelect(c)} className={selected?.callSid===c.callSid?"conversation-row active":"conversation-row"}><strong>{lead?.company||`${lead?.firstName||"Unknown"} ${lead?.lastName||"prospect"}`}</strong><span>{new Date(c.startedAt).toLocaleString()} · {c.transcript.length} turns</span>{lead?.selectedProduct&&<small>{lead.selectedProduct}</small>}</button>}):<p className="empty-copy">No captured EBC AI calls yet.</p>}</div><div className="table-card transcript"><div className="table-title"><div><h2>Call Transcript</h2><p>{selected?.callSid||"Select a conversation"}</p></div></div>{selected?.transcript?.length?selected.transcript.map((turn,i)=><div key={`${turn.at}-${i}`} className={turn.role==="buddy"?"turn ai":"turn prospect"}><div><b>{turn.role==="buddy"?"EBC AI":"Prospect"}</b><p>{turn.text}</p><small>{new Date(turn.at).toLocaleTimeString()}</small></div></div>):<p className="empty-copy">No transcript selected.</p>}</div></div>}
function AnalyticsView({events}:{events:EbcEvent[]}){const counts=events.reduce((m:any,e)=>{m[e.type]=(m[e.type]||0)+1;return m;},{});const recent=events.slice(0,50);return <div className="analytics-layout"><div className="table-card analytics-card"><div className="table-title"><div><h2>Automation Analytics</h2><p>Live operational telemetry from the EBC AI call center.</p></div></div><div className="analytics-kpis"><Kpi label="AI Calls" value={events.filter(e=>e.type==="call.created").length} icon={<Phone/>}/><Kpi label="Customer Turns" value={counts["stt.transcript.final"]||0} icon={<MessageSquare/>}/><Kpi label="Quote / Agreement Events" value={events.filter(e=>e.type.includes("docusign")||e.type.includes("estimate")).length} icon={<FileSignature/>}/><Kpi label="Build Events" value={events.filter(e=>e.type.includes("delivery")).length} icon={<HardDrive/>}/></div></div><div className="table-card recent-card"><div className="table-title"><div><h2>Recent Activity</h2><p>Newest calls, quotes, agreements, and build events.</p></div></div>{recent.map(e=><div key={e.id} className="activity-row"><span>{new Date(e.createdAt).toLocaleString()}</span><b>{e.type}</b><span>{e.contactId||"—"}</span><span>{e.text||e.payload?.productName||e.payload?.deliveryAt||e.payload?.status||"Workflow event"}</span></div>)}</div></div>}

function Status({value}:{value:string}){const good=["sent","emailed","signed","completed","scheduled","approved","confirmed","rescheduled"].includes(value.toLowerCase());return <span className={good?"status good":"status"}>{good&&<CheckCircle2 size={14}/>} {value}</span>}
function LeadDetail({lead,events,onAction}:{lead:Lead,events:EbcEvent[],onAction:(l:Lead,a:LeadAction)=>void}){const history=[...events].filter(isWorkflowEvent).sort((a,b)=>b.createdAt-a.createdAt);return <aside className="detail-panel"><div className="detail-person"><span className="detail-avatar">{lead.firstName[0]}{lead.lastName?.[0]}</span><div><span className="eyebrow">SELECTED OPPORTUNITY</span><h2>{lead.company||`${lead.firstName} ${lead.lastName}`}</h2><p>{lead.company&&`${lead.firstName} ${lead.lastName} · `}{lead.selectedProduct||lead.interest}</p></div></div><div className="detail-score"><span>Qualification score</span><strong>{lead.score}</strong></div><section><h3>Contact</h3><p><Phone size={15}/>{lead.phone||"No phone"}</p><p><Mail size={15}/>{lead.email||"No email"}</p></section><section><h3>EBC AI workflow</h3><Timeline icon={<MessageSquare/>} title="Automated outreach" value={lead.outreachStatus||((lead.stage!=="New Inquiry")?"Active":"Queued")}/><Timeline icon={<Phone/>} title="Voice qualification" value={lead.callStatus||"Not called"}/><Timeline icon={<FileSignature/>} title="Quote / Agreement" value={lead.estimateNumber?`Estimate ${lead.estimateNumber} sent`:lead.documentStatus||"Not sent"}/><Timeline icon={<CalendarDays/>} title="Build consultation" value={lead.appointmentStatus?`${lead.appointmentStatus}${lead.appointmentStart?` · ${formatEtDateTime(lead.appointmentStart)}`:""}`:"Not requested"}/><Timeline icon={<ShieldCheck/>} title="Build / Installation" value={lead.deliveryAt?`${lead.deliveryStatus||"Scheduled"} · ${formatEtDateTime(lead.deliveryAt)}`:"Not scheduled"}/></section>{lead.estimateNumber&&<div className="estimate-summary"><span>Latest estimate</span><b>{lead.estimateNumber}</b>{Boolean(lead.estimatedMonthlyTotal)&&<strong>{Number(lead.estimatedMonthlyTotal).toLocaleString("en-US",{style:"currency",currency:"USD"})}</strong>}</div>}<section className="workflow-history"><h3>Activity history <span>{history.length}</span></h3>{history.length?history.slice(0,30).map(event=><details className="workflow-event" key={event.id}><summary><span className={event.type.includes("failed")?"event-dot failed":"event-dot"}/><span><b>{workflowTitle(event)}</b><small>{workflowDescription(event)}</small><time>{new Date(event.createdAt).toLocaleString()}</time></span><ChevronRight size={14}/></summary><div className="workflow-event-detail">{workflowDetails(event).map(([label,value])=><div key={label}><span>{label}</span><p>{value}</p></div>)}</div></details>):<p className="empty-history">No workflow activity recorded yet.</p>}</section>{lead.docusignEnvelopeId&&<a className="primary-action secondary" href={`${DOC_BASE}/${encodeURIComponent(lead.id)}`} target="_blank" rel="noreferrer"><FileText size={16}/> View Agreement PDF</a>}{lead.calendarEventUrl&&<a className="primary-action secondary" href={lead.calendarEventUrl} target="_blank" rel="noreferrer"><CalendarDays size={16}/> Open Build Event</a>}<div className="detail-date">{lead.deliveryAt&&`Build / install: ${formatEtMonthDay(lead.deliveryAt)} at ${formatEtTime(lead.deliveryAt)} ET`}</div><button className="primary-action" onClick={()=>onAction(lead,"call")}><Phone size={16}/> Start / Resume AI Call</button></aside>}
function Timeline({icon,title,value}:{icon:any,title:string,value:string}){return <div className="timeline"><span>{icon}</span><div><b>{title}</b><small>{value}</small></div></div>}
