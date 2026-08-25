const buddyEvents = require("../../../layers/domain/buddy-events");

module.exports = async function handler({ method, params, env }) {
  if (method !== "GET") return { ok:false, error:"GET only" };
  const eventsDb = env?.EVENTS_DB || env?.BUDDY_DB;
  if (!eventsDb) return { ok:false, error:"Communication event database is not configured" };

  const contactId = String(params.contactId || "").trim();
  const limit = Number(params.limit || 1000);
  const conversations = await buddyEvents.conversations(eventsDb, { contactId, limit });
  const events = await buddyEvents.list(eventsDb, { contactId, limit:Math.min(limit, 500) });
  return { ok:true, data:{ conversations, events } };
};
