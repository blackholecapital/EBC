import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { HelpCircle, MessageSquare, Mic, MicOff, PhoneOff, Video, X } from "lucide-react";
import type { Room as LiveKitRoom } from "livekit-client";

export type SupportLead = {
  id:string;
  firstName:string;
  lastName:string;
  company?:string;
  interest?:string;
  selectedProduct?:string;
  location?:string;
  score?:number;
};

type TranscriptEntry = { role:"customer"|"buddy"; text:string; segmentId:string; at:number };
type ChatMessage = { id:string; role:"customer"|"buddy"|"system"; text:string };

const SUPPORT_IMAGE = "/buddys/ACE-Support.jpg";

const FAQS = [
  ["Where do I start?", "Pipeline is the fastest operating view. Each column is a project stage; select a lead to open its full account and workflow controls."],
  ["How do lead cards work?", "Cards show the customer, requested product, location, lead score, current stage, latest workflow event, and the opportunity value. Use the icons for email, AI call, SMS, proposal, or scheduling."],
  ["What is the Leads tab for?", "Leads gives you a larger searchable directory. Filter by EBC product category, open any account, and launch the same outreach or support actions."],
  ["Where are estimates and contracts?", "Quotes & Contracts collects preliminary estimates, sent proposals, DocuSign agreements, and their current delivery or signature status."],
  ["How do appointments work?", "Customer-requested consultations appear in Appointments. Review the requested time, approve or reschedule it, and the workflow sends the customer confirmation."],
  ["Where do I review conversations?", "Conversations contains captured EBC AI call transcripts. Analytics summarizes workflow volume, outcomes, and pipeline activity."],
  ["Does the dashboard update automatically?", "Yes. Customer records refresh every few seconds and communication events refresh automatically. The status indicator shows whether live EBC data is connected."],
];

function displayName(lead:SupportLead){
  return lead.company || `${lead.firstName} ${lead.lastName}`.trim() || "EBC customer";
}

export function SupportDock({ lead, onVideo }:{ lead:SupportLead; onVideo:(lead:SupportLead)=>void }){
  const [open,setOpen]=useState(false);
  return <div className="support-dock">
    {open&&<section className="support-faq" role="dialog" aria-label="EBC dashboard help">
      <header><div><span>24/7 EBC SUPPORT</span><h2>Dashboard FAQ</h2></div><button aria-label="Close FAQ" onClick={()=>setOpen(false)}><X size={18}/></button></header>
      <p className="support-faq-intro">Quick answers for operating the lead pipeline, customer workflows, documents, and scheduling.</p>
      <div className="support-faq-list">{FAQS.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      <button className="support-video-cta" onClick={()=>onVideo(lead)}><Video size={17}/> Start 24/7 video consultation</button>
      <small>Support context: {displayName(lead)}</small>
    </section>}
    <button className="support-dock-button" onClick={()=>setOpen(current=>!current)} aria-expanded={open}><HelpCircle size={20}/><span><b>24/7 Support</b><small>FAQ & live consultation</small></span></button>
  </div>;
}

export function SupportVideoModal({ lead, onClose }:{ lead:SupportLead; onClose:()=>void }){
  const [status,setStatus]=useState("Creating a private EBC support room…");
  const [chatState,setChatState]=useState("Connecting…");
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [videoEnabled,setVideoEnabled]=useState(false);
  const [micEnabled,setMicEnabled]=useState(false);
  const [messages,setMessages]=useState<ChatMessage[]>([{id:"welcome",role:"buddy",text:`Hi ${lead.firstName||"there"}, I’m EILA Support. I can help you use this dashboard or review the selected EBC lead.`}]);
  const roomRef=useRef<LiveKitRoom|null>(null);
  const sessionPromiseRef=useRef<Promise<LiveKitRoom>|null>(null);
  const videoMountRef=useRef<HTMLDivElement|null>(null);
  const remoteVideoRef=useRef<HTMLVideoElement|null>(null);
  const remoteAudioRef=useRef<Set<HTMLAudioElement>>(new Set());
  const videoEnabledRef=useRef(false);
  const transcriptRef=useRef<TranscriptEntry[]>([]);
  const sessionRef=useRef({contactId:lead.id,room:"",sessionId:""});
  const closingRef=useRef(false);

  const addMessage=useCallback((text:string,role:ChatMessage["role"],segmentId="")=>{
    const clean=String(text||"").trim();if(!clean)return;
    const id=segmentId||`${role}-${Date.now()}-${Math.random()}`;
    setMessages(current=>current.some(item=>item.id===id)?current:[...current,{id,role,text:clean}]);
    if(role!=="system"&&!transcriptRef.current.some(item=>item.segmentId===id)){
      transcriptRef.current.push({role:role==="customer"?"customer":"buddy",text:clean.slice(0,4000),segmentId:id.slice(0,240),at:Date.now()});
    }
  },[]);

  const persistTranscript=useCallback(async(ended=false)=>{
    if(!sessionRef.current.sessionId)return;
    try{await fetch("/api/video/transcript",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...sessionRef.current,ended,messages:transcriptRef.current}),keepalive:ended});}catch{}
  },[]);

  const teardownSession=useCallback(()=>{
    const wasClosing=closingRef.current;
    closingRef.current=true;
    if(!wasClosing)void persistTranscript(true);
    const activeRoom=roomRef.current;
    roomRef.current=null;
    void activeRoom?.disconnect();
    const audioNodes=remoteAudioRef.current;
    audioNodes.forEach(node=>node.remove());
    audioNodes.clear();
  },[persistTranscript]);

  const attachTrack=useCallback((track:any,publication:any,participant:any)=>{
    const id=publication?.trackSid||track?.sid||`${participant?.identity||"remote"}-${track.kind}`;
    if(track.kind==="video"){
      const video=document.createElement("video");video.autoplay=true;video.muted=true;video.defaultMuted=true;video.playsInline=true;track.attach(video);remoteVideoRef.current=video;
      if(videoEnabledRef.current&&videoMountRef.current)videoMountRef.current.replaceChildren(video);
    }
    if(track.kind==="audio"){
      const audio=document.createElement("audio");audio.autoplay=true;audio.muted=!videoEnabledRef.current;audio.style.display="none";document.body.appendChild(audio);track.attach(audio);remoteAudioRef.current.add(audio);
    }
    setChatState("EILA Support is online");setStatus(videoEnabledRef.current?"Live with EILA Support":"EILA Support is ready");
    console.info("EBC SUPPORT TRACK",{id,kind:track.kind,participant:participant?.identity});
  },[]);

  const ensureSession=useCallback(async()=>{
    if(roomRef.current)return roomRef.current;
    if(sessionPromiseRef.current)return sessionPromiseRef.current;
    sessionPromiseRef.current=(async()=>{
      setChatState("Connecting…");setStatus("Creating a private EBC support room…");
      const response=await fetch("/api/video/session",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({contactId:lead.id,firstName:lead.firstName,lastName:lead.lastName,company:lead.company,interest:lead.selectedProduct||lead.interest,location:lead.location,leadScore:lead.score,source:"ebc-dashboard-support"})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data?.ok===false)throw new Error(data?.error||"EBC support session failed");
      const livekitUrl=data.livekitUrl||data.url||data.livekit_url,token=data.token||data.accessToken||data.access_token;
      if(!livekitUrl||!token)throw new Error("The video broker returned no LiveKit credentials");
      sessionRef.current={contactId:String(data.contactId||lead.id),room:String(data.room||""),sessionId:String(data.dispatchId||data.sessionId||data.room||"")};
      if(Array.isArray(data?.history?.messages)&&data.history.messages.length){
        const restored=data.history.messages.map((entry:any,index:number)=>({id:String(entry.segmentId||`history-${index}`),role:entry.role==="customer"?"customer":"buddy",text:String(entry.text||"")}));
        transcriptRef.current=data.history.messages.map((entry:any,index:number)=>({role:entry.role==="customer"?"customer":"buddy",text:String(entry.text||""),segmentId:String(entry.segmentId||`history-${index}`),at:Number(entry.at||Date.now())}));
        setMessages([...restored,{id:`restored-${Date.now()}`,role:"system",text:"Previous support conversation restored."}]);
      }
      const { Room, RoomEvent }=await import("livekit-client");
      const room=new Room({adaptiveStream:true,dynacast:true});roomRef.current=room;
      room.registerTextStreamHandler("lk.transcription",async(reader:any,participantInfo:any)=>{
        const text=String(await reader.readAll()).trim(),attributes=reader.info?.attributes||{},final=attributes["lk.transcription_final"];
        if(!text||final==="false")return;
        const id=attributes["lk.segment_id"]||reader.info?.id||`${participantInfo?.identity||"remote"}:${text}`;
        const role=participantInfo?.identity===room.localParticipant.identity?"customer":"buddy";addMessage(text,role,id);
        if(role==="buddy")void persistTranscript(false);
      });
      room.on(RoomEvent.ParticipantConnected,()=>{setChatState("EILA Support is online");setStatus("EILA Support joined — video is starting…");});
      room.on(RoomEvent.TrackSubscribed,attachTrack);
      room.on(RoomEvent.TrackUnsubscribed,(track:any)=>track.detach().forEach((node:HTMLElement)=>{if(node===remoteVideoRef.current)remoteVideoRef.current=null;if(node instanceof HTMLAudioElement)remoteAudioRef.current.delete(node);node.remove();}));
      room.on(RoomEvent.Disconnected,()=>{if(closingRef.current)return;roomRef.current=null;sessionPromiseRef.current=null;setChatState("Disconnected");setStatus("Support room disconnected");});
      await room.connect(livekitUrl,token);setChatState("Waiting for EILA Support…");setStatus("Room connected — EILA Support is joining…");
      return room;
    })();
    try{return await sessionPromiseRef.current;}catch(error){roomRef.current=null;sessionPromiseRef.current=null;throw error;}
  },[addMessage,attachTrack,lead,persistTranscript]);

  useEffect(()=>{void ensureSession().catch(error=>{setChatState("Offline");setStatus(error instanceof Error?error.message:"EBC support is unavailable");addMessage(error instanceof Error?error.message:"EBC support is unavailable","system");});return teardownSession;},[addMessage,ensureSession,teardownSession]);

  async function connectVideo(){
    setBusy(true);setStatus("Connecting EILA Support video…");
    try{const room=await ensureSession();videoEnabledRef.current=true;setVideoEnabled(true);setMicEnabled(true);await room.localParticipant.setMicrophoneEnabled(true);remoteAudioRef.current.forEach(audio=>{audio.muted=false;});if(typeof room.startAudio==="function")await room.startAudio().catch(()=>{});if(remoteVideoRef.current&&videoMountRef.current)videoMountRef.current.replaceChildren(remoteVideoRef.current);setStatus(remoteVideoRef.current?"Live with EILA Support":"EILA Support joined — waiting for video…");setChatState("Live video connected");}
    catch(error){const message=error instanceof Error?error.message:"Video connection failed";setStatus(message);addMessage(message,"system");}
    finally{setBusy(false);}
  }

  async function toggleMic(){const room=roomRef.current;if(!room)return;const next=!micEnabled;await room.localParticipant.setMicrophoneEnabled(next);setMicEnabled(next);}
  async function submit(event:FormEvent){event.preventDefault();const text=input.trim();if(!text)return;setInput("");addMessage(text,"customer");try{const room=await ensureSession();await room.localParticipant.sendText(text,{topic:"lk.chat"});void persistTranscript(false);}catch(error){addMessage(error instanceof Error?error.message:"Messaging is unavailable","system");}}
  async function close(){closingRef.current=true;await persistTranscript(true);await roomRef.current?.disconnect();onClose();}

  return <div className="support-video-modal" role="dialog" aria-modal="true" aria-label="EBC live support" onMouseDown={event=>{if(event.target===event.currentTarget)void close();}}>
    <section className="support-video-room">
      <header><div><span className="support-live-dot"/><b>EILA · EBC 24/7 Support</b></div><button onClick={()=>void close()} aria-label="Close video support"><X size={20}/></button></header>
      <div className="support-video-workspace">
        <div className="support-video-stage">
          <div className="support-video-mount" ref={videoMountRef}><div className="support-video-placeholder"><img src={SUPPORT_IMAGE} alt="EILA, Everything Built Custom support assistant"/><b>{status}</b><span>Ask about the dashboard, lead pipeline, estimates, appointments, or customer workflows.</span></div></div>
          <div className="support-video-controls"><button className="support-round-button" onClick={()=>void toggleMic()} disabled={!videoEnabled} aria-label={micEnabled?"Mute microphone":"Unmute microphone"}>{micEnabled?<Mic size={19}/>:<MicOff size={19}/>}</button><button className="support-connect-button" disabled={busy||videoEnabled} onClick={()=>void connectVideo()}><Video size={18}/>{busy?"Connecting…":videoEnabled?"Video connected":"Connect on video"}</button><button className="support-round-button danger" onClick={()=>void close()} aria-label="End support session"><PhoneOff size={19}/></button></div>
          <p>Microphone access begins only after you connect. Never share passwords, API keys, or payment details.</p>
        </div>
        <aside className="support-chat-panel"><header><div><span className="support-live-dot"/><b>Messages with EILA Support</b></div><span>{chatState}</span></header><div className="support-chat-stream">{messages.map(message=><div key={message.id} className={`support-bubble ${message.role}`}>{message.text}</div>)}</div><form onSubmit={submit}><MessageSquare size={18}/><input value={input} onChange={event=>setInput(event.target.value)} maxLength={1200} placeholder="Ask how to use the EBC dashboard…"/><button type="submit">Send</button></form></aside>
      </div>
    </section>
  </div>;
}
