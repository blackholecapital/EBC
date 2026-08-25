export function nextAppointmentRequest(contact = {}, details = {}) {
  const priorHistory = Array.isArray(contact.appointmentHistory) ? contact.appointmentHistory : [];
  const requestedAt = String(details.requestedAt || new Date().toISOString());
  const requestId = String(details.requestId || `appt_${crypto.randomUUID()}`);
  const requestCount = Number(contact.appointmentRequestCount || 0) + 1;
  const historyEntry = {
    id:requestId,
    status:"Requested",
    start:details.start || null,
    end:details.end || null,
    timeZone:String(details.timeZone || "America/New_York"),
    label:String(details.label || ""),
    notes:String(details.notes || "").trim(),
    requestedAt,
    source:String(details.source || "ebc-workflow"),
  };
  return {
    requestId,
    requestCount,
    requestedAt,
    appointmentHistory:[...priorHistory, historyEntry].slice(-20),
  };
}
