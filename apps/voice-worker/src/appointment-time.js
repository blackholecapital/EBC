const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit", weekday:"long",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { year:+values.year, month:+values.month, day:+values.day, weekday:String(values.weekday).toLowerCase(), hour:+values.hour, minute:+values.minute, second:+values.second };
}

function timeZoneOffsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
}

function localToIso(parts, timeZone) {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  let date = new Date(guess);
  for (let attempt = 0; attempt < 2; attempt += 1) date = new Date(guess - timeZoneOffsetMinutes(date, timeZone) * 60000);
  return date.toISOString();
}

function addCalendarDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return { year:date.getUTCFullYear(), month:date.getUTCMonth() + 1, day:date.getUTCDate() };
}

function parseClock(text) {
  const match = /\b(?:at|around|for)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i.exec(text);
  if (!match) return null;
  const namedHours={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
  let hour = /^\d+$/.test(match[1]) ? Number(match[1]) : namedHours[match[1].toLowerCase()];
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || "").toLowerCase().replaceAll(".", "");
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  return { hour, minute };
}

export function parseRequestedAppointment(value = "", { now = new Date(), timeZone = "America/New_York" } = {}) {
  const text = String(value || "").toLowerCase();
  const clock = parseClock(text);
  if (!clock) return null;
  const current = zonedParts(now, timeZone);
  let date = null;
  if (/\btomorrow\b/.test(text)) date = addCalendarDays(current, 1);
  else if (/\btoday\b/.test(text)) date = { year:current.year, month:current.month, day:current.day };
  else {
    const weekday = DAY_NAMES.findIndex(day => new RegExp(`\\b${day}(?:s)?\\b`, "i").test(text));
    if (weekday >= 0) {
      const currentWeekday = DAY_NAMES.indexOf(current.weekday);
      let offset = (weekday - currentWeekday + 7) % 7;
      if (offset === 0) offset = 7;
      date = addCalendarDays(current, offset);
    }
  }
  if (!date) return null;
  const startIso = localToIso({ ...date, ...clock }, timeZone);
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday:"long", month:"long", day:"numeric", hour:"numeric", minute:"2-digit", timeZoneName:"short" }).format(new Date(startIso));
  return { startIso, timeZone, label };
}
