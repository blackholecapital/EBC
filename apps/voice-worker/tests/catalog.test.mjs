import assert from "node:assert/strict";
import test from "node:test";

import { getEbcPreliminaryEstimate, getBuddyDemoOptions } from "../src/catalog.js";

test("catalog products expose EBC products", () => {
  for (const interest of ["Power & Fuse Blocks", "Fan Kits", "Programming & Remote Assist"]) {
    const options = getBuddyDemoOptions(interest);
    assert.ok(options.length > 0);
  }
});

test("builds a preliminary project estimate from an approved product", () => {
  const quote = getEbcPreliminaryEstimate({ interest:"Power & Fuse Blocks", selectedProduct:"G2 Power Block", location:"Tampa, Florida" });
  assert.equal(quote.serviceName, "G2 Power Block");
  assert.equal(quote.monthlyTotal, 239.99);
  assert.equal(quote.setupFeeDue, 0);
});

test("keeps product-specific price and cart context", () => {
  const quote = getEbcPreliminaryEstimate({ interest:"Fan Kits", selectedProduct:"Front & Rear Fan Kit — Rover", conversation:"I have a 2025 Denago Rover XL", location:"Florida" });
  assert.equal(quote.facilityCode, "EBC");
  assert.equal(quote.monthlyTotal, 539.99);
  assert.match(quote.lineItems[0].description, /Denago Rover XL/i);
});

test("routes custom fabrication to human pricing review", () => {
  const quote = getEbcPreliminaryEstimate({ interest:"Custom Project", selectedProduct:"Custom Project Consultation", location:"Tampa" });
  assert.equal(quote, null);
});

test("does not invent a priced product when cart fitment is unresolved", () => {
  const quote = getEbcPreliminaryEstimate({
    interest:"Custom Roofs & Enclosures",
    conversation:"I have an E-Z-GO 550 and want a plug-and-play custom roof kit",
    location:"Tampa",
  });
  assert.equal(quote, null);
});
