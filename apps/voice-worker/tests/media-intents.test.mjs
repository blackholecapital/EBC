import assert from "node:assert/strict";
import test from "node:test";

import { offersAppointment, requestsSalesAppointment } from "../src/media.js";

test("recognizes natural calendar requests", () => {
  assert.equal(requestsSalesAppointment("put me on the calendar"), true);
  assert.equal(requestsSalesAppointment("do the calendar"), true);
  assert.equal(requestsSalesAppointment("schedule a phone call"), true);
});

test("recognizes when EBC AI offers the calendar", () => {
  assert.equal(offersAppointment("I can put that on the calendar for you."), true);
  assert.equal(offersAppointment("Would you like me to request an appointment?"), true);
});
