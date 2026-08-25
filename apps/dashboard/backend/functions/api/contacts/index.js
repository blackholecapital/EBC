const contacts = require("../../../layers/domain/contacts");
const { progressiveLeadScore, baselineOpportunityValue } = require("../../../layers/domain/lead-intelligence");

const STAGES = ["New Lead", "Contacted", "Engaged", "Estimate Sent", "Docs Sent", "Scheduled", "Closed"];
const stageRank = (value) => Math.max(0, STAGES.indexOf(String(value || "New Lead")));
const eventDb = (env) => env?.EVENTS_DB || env?.BUDDY_DB;

function furthestStage(...values) {
  return values.filter(Boolean).sort((a, b) => stageRank(b) - stageRank(a))[0] || "New Lead";
}

function inferStage(contact = {}) {
  if (String(contact.stage || "") === "Closed" || String(contact.deliveryStatus || "").toLowerCase() === "completed") return "Closed";
  if (contact.deliveryAt || String(contact.deliveryStatus || "").toLowerCase() === "scheduled") return "Scheduled";
  if (contact.docusignEnvelopeId || ["sent", "signed", "completed"].includes(String(contact.documentStatus || "").toLowerCase())) return "Docs Sent";
  if (contact.estimateNumber || String(contact.estimateStatus || "").toLowerCase() === "sent") return "Estimate Sent";
  if (contact._buddyEngaged || contact.selectedProduct) return "Engaged";

  const call = String(contact.callStatus || "").toLowerCase();
  if (call.includes("completed") || call.includes("in-progress") || call.includes("in progress") || call.includes("answered") || call.includes("connected")) return "Engaged";
  if (contact._buddyContacted || contact.outreachStatus === "Sent") return "Contacted";
  if (call.includes("requested") || call.includes("ringing") || call.includes("initiated")) return "Contacted";
  return contact.stage || "New Lead";
}

function hydrate(row) {
  let data = {};
  try { data = JSON.parse(row.contact_json || "{}"); } catch {}
  return { ...data, id:data.id || row.contact_id, _buddyUpdatedAt:Number(row.updated_at || 0) };
}

async function buddyStates(env) {
  const binding = eventDb(env);
  if (!binding) return [];
  try {
    await binding.prepare(`
      CREATE TABLE IF NOT EXISTS buddy_contacts (
        contact_id TEXT PRIMARY KEY,
        phone TEXT,
        contact_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();
    await binding.prepare(`
      CREATE TABLE IF NOT EXISTS buddy_sms_sessions (
        phone TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        contact_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();

    const [contactsRows, legacyRows] = await Promise.all([
      binding.prepare(`SELECT contact_id, contact_json, updated_at FROM buddy_contacts ORDER BY updated_at DESC`).all(),
      binding.prepare(`SELECT contact_id, contact_json, updated_at FROM buddy_sms_sessions ORDER BY updated_at DESC`).all(),
    ]);

    const byId = new Map();
    for (const row of legacyRows.results || []) byId.set(row.contact_id, hydrate(row));
    for (const row of contactsRows.results || []) {
      const next = hydrate(row);
      const prior = byId.get(row.contact_id);
      if (!prior || Number(next._buddyUpdatedAt || 0) >= Number(prior._buddyUpdatedAt || 0)) byId.set(row.contact_id, next);
    }
    return [...byId.values()];
  } catch (error) {
    console.error("Buddy dashboard state lookup failed", error);
    return [];
  }
}

async function workflowFacts(env) {
  const facts = new Map();
  const binding = eventDb(env);
  if (!binding) return facts;
  try {
    const result = await binding.prepare(`
      SELECT contact_id, event_type, payload_json, created_at
      FROM buddy_communication_events
      WHERE contact_id IS NOT NULL AND contact_id <> ''
      ORDER BY created_at ASC
      LIMIT 10000
    `).all();

    for (const row of result.results || []) {
      const id = String(row.contact_id || "");
      if (!id) continue;
      const fact = facts.get(id) || {
        contacted:false,
        engaged:false,
        estimateSent:false,
        docsSent:false,
        scheduled:false,
        latestCallStatus:"",
        latestEmail:null,
        estimate:null,
        customerWordCount:0,
        requirements:"",
        callCompleted:false,
        productSelected:false,
        salesHandoff:false,
        appointmentRequested:false,
        appointmentConfirmed:false,
        closed:false,
        updatedAt:0,
      };
      const type = String(row.event_type || "").toLowerCase();
      let payload = {};
      try { payload = JSON.parse(row.payload_json || "{}"); } catch {}

      if (
        type === "call.requested" || type === "call.created" ||
        type === "call.initiated" || type === "call.ringing" ||
        type === "sms.reply"
      ) fact.contacted = true;

      if (
        type === "call.answered" || type === "call.in-progress" || type === "call.completed" ||
        type === "stt.transcript.final" || type === "buddy.turn.started" ||
        type.startsWith("buddy.product.") || type.startsWith("buddy.delivery.") ||
        type === "sales.handoff.created" || type === "estimate.sent" ||
        type === "stream.media.stopped"
      ) {
        fact.contacted = true;
        fact.engaged = true;
      }

      if (type === "stt.transcript.final") {
        const transcript = String(payload.transcript || row.text || "").trim();
        fact.customerWordCount += transcript ? transcript.split(/\s+/).length : 0;
      }
      if (type === "call.completed") fact.callCompleted = true;
      if (type.startsWith("buddy.product.")) fact.productSelected = true;
      if (type === "sales.handoff.created") {
        fact.salesHandoff = true;
        fact.requirements = String(payload.requirements || fact.requirements || "");
      }

      if (type === "email.sent") {
        fact.contacted = true;
        fact.latestEmail = payload;
        if (String(payload.messageType || "").toLowerCase() === "ebc-preliminary-estimate") {
          fact.engaged = true;
          fact.estimateSent = true;
        }
      }
      if (type === "estimate.sent") {
        fact.contacted = true;
        fact.engaged = true;
        fact.estimateSent = true;
        fact.estimate = payload;
        fact.requirements = String(payload.requirements || fact.requirements || "");
      }
      if (type === "docusign.sent") {
        fact.contacted = true;
        fact.engaged = true;
        fact.docsSent = true;
      }
      if (type === "delivery.scheduled") {
        fact.contacted = true;
        fact.engaged = true;
        fact.scheduled = true;
      }
      if (type === "sales.appointment.requested") fact.appointmentRequested = true;
      if (type === "sales.appointment.approved" || type === "sales.appointment.rescheduled") {
        fact.appointmentRequested = true;
        fact.appointmentConfirmed = true;
      }
      if (type === "opportunity.closed") fact.closed = true;

      if (type.startsWith("call.")) {
        fact.latestCallStatus = type.slice(5).replaceAll("-", " ");
      }
      fact.updatedAt = Math.max(fact.updatedAt, Number(row.created_at || 0));
      facts.set(id, fact);
    }
  } catch (error) {
    // Old databases may not have the event table yet. Contact data still works without it.
    console.warn("Buddy workflow event facts unavailable", error?.message || error);
  }
  return facts;
}

async function mergedContacts(env) {
  const base = contacts.list();
  const [live, facts] = await Promise.all([buddyStates(env), workflowFacts(env)]);
  const byId = new Map(base.map(row => [row.id, { ...row, _dashboardStage:row.stage || "New Lead" }]));

  for (const state of live) {
    const baseRow = byId.get(state.id) || {};
    const merged = { ...baseRow, ...state };
    merged._dashboardStage = baseRow._dashboardStage || baseRow.stage || "New Lead";
    byId.set(state.id, merged);
  }

  return [...byId.values()].map(row => {
    const fact = facts.get(row.id);
    const next = {
      ...row,
      _buddyContacted:Boolean(fact?.contacted),
      _buddyEngaged:Boolean(fact?.engaged),
    };
    if (fact?.latestEmail) next.outreachStatus = "Sent";
    if (fact?.estimateSent) {
      next.estimateStatus = "Sent";
      next.estimateNumber = next.estimateNumber || fact.estimate?.estimateNumber || "";
      next.estimateSentAt = next.estimateSentAt || (fact.estimate?.ts ? new Date(fact.estimate.ts).toISOString() : "");
      next.estimatedMonthlyTotal = Number(next.estimatedMonthlyTotal || fact.estimate?.monthlyTotal || 0);
    }
    if (fact?.docsSent && (!next.documentStatus || /not sent/i.test(next.documentStatus))) next.documentStatus = "Sent";
    if (fact?.scheduled && (!next.deliveryStatus || /not scheduled/i.test(next.deliveryStatus))) next.deliveryStatus = "Scheduled";
    if (fact?.engaged && (!next.callStatus || /not called|requested|ringing|initiated/i.test(next.callStatus))) {
      next.callStatus = "Call connected";
    } else if (fact?.latestCallStatus && (!next.callStatus || /not called/i.test(next.callStatus))) {
      next.callStatus = `Call ${fact.latestCallStatus}`;
    }
    next.stage = furthestStage(next._dashboardStage, next.stage, inferStage(next));
    const scoring = progressiveLeadScore(next, fact || {});
    next.initialLeadScore = scoring.initialScore;
    next.leadScore = scoring.score;
    next.leadScoreBreakdown = scoring.items;
    next.value = baselineOpportunityValue(next);
    return next;
  }).sort((a,b) => {
    const av = Number(a._buddyUpdatedAt || 0) || Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const bv = Number(b._buddyUpdatedAt || 0) || Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return bv - av;
  });
}

module.exports = async function handler({ method, body, params, env }) {
  if (method === "GET") return { ok:true, data:await mergedContacts(env) };
  if (method === "POST" && params.action === "import") return { ok:true, data:contacts.importStub(body.csv || body.rows || "") };
  if (method === "POST") return { ok:true, data:contacts.create(body) };
  if (method === "PUT") return { ok:true, data:contacts.update(params.id, body) };
  if (method === "DELETE") return { ok:true, data:contacts.remove(params.id) };
  return { ok:false, error:"Unsupported contacts operation" };
};
