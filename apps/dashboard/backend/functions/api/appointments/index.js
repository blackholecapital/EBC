const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };
  const contactId = String(body?.contactId || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();
  if (!contactId) return { ok:false, error:"contactId required" };
  if (!["request", "approve", "reschedule"].includes(action)) return { ok:false, error:"action must be request, approve, or reschedule" };

  const contact = contacts.list().find(row => row.id === contactId);
  if (!contact) return { ok:false, error:"Contact not found" };

  let result;
  try {
    result = await conciergePost(env, "/internal/sales-appointment", {
      ...body,
      contactId,
      action,
      contact,
      source:"ebc-operations-dashboard",
    });
  } catch (error) {
    result = { ok:false, error:error.message };
  }

  activity.record({
    type:result?.ok
      ? `sales.appointment.${({ request:"requested", approve:"approved", reschedule:"rescheduled" })[action]}`
      : `sales.appointment.${action}.failed`,
    entityType:"contact",
    entityId:contactId,
    message:result?.ok ? `Sales appointment ${action} completed` : `Sales appointment ${action} failed`,
    metadata:{ startIso:body?.startIso || "", timeZone:body?.timeZone || "America/New_York", error:result?.error || "" },
  });

  return result?.ok
    ? { ok:true, data:result }
    : { ok:false, error:result?.error || "Appointment workflow failed" };
};
