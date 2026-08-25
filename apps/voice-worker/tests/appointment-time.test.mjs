import assert from "node:assert/strict";
import test from "node:test";

import { parseRequestedAppointment } from "../src/appointment-time.js";

const now = new Date("2026-08-16T14:00:00Z");

test("parses tomorrow at three as an Eastern afternoon request", () => {
  const result = parseRequestedAppointment("I'd like tomorrow at 3", { now });
  assert.equal(result.startIso, "2026-08-17T19:00:00.000Z");
  assert.match(result.label, /Monday, August 17.*3:00 PM EDT/);
});

test("parses a named weekday and explicit morning time", () => {
  const result = parseRequestedAppointment("Could we meet Tuesday at 10:30 am?", { now });
  assert.equal(result.startIso, "2026-08-18T14:30:00.000Z");
});

test("parses a spoken hour", () => {
  const result = parseRequestedAppointment("Tomorrow at three please", { now });
  assert.equal(result.startIso, "2026-08-17T19:00:00.000Z");
});

test("does not invent a date when the customer has not supplied one", () => {
  assert.equal(parseRequestedAppointment("Please schedule a sales call", { now }), null);
});
