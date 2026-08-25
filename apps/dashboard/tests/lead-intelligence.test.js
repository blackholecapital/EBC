const assert = require("assert");
const { initialLeadScore, progressiveLeadScore, baselineOpportunityValue } = require("../backend/layers/domain/lead-intelligence");

const completeLead = {
  firstName:"Jamie", lastName:"Rivera", company:"Example Co", phone:"+18135551212", email:"jamie@example.com",
  interest:"Custom Project", location:"Clearwater, FL", preferredContactMethod:"Phone", preferredContactTime:"Morning",
  comments:"We have a 2025 Denago Rover XL and need a roof, lighting, speakers, and installation within sixty days.",
  leadSource:"everythingbuiltcustom.com", smsConsent:true,
};

const initial = initialLeadScore(completeLead);
assert(initial.score > 50 && initial.score <= 68, "complete initial lead is useful but leaves room for qualification");

const afterCall = progressiveLeadScore(completeLead, { contacted:true, engaged:true, callCompleted:true, customerWordCount:25 });
assert(afterCall.score > initial.score, "AI conversation increases score");

const afterProposal = progressiveLeadScore({ ...completeLead, estimateNumber:"EBC-100", documentStatus:"Sent" }, {
  contacted:true, engaged:true, callCompleted:true, customerWordCount:25, productSelected:true, estimateSent:true, docsSent:true,
});
assert(afterProposal.score > afterCall.score, "proposal and documents increase score");
assert(afterProposal.score <= 100, "score is capped at 100");

assert.strictEqual(baselineOpportunityValue({ interest:"Custom DS18 Build" }), 1599.99);
assert.strictEqual(baselineOpportunityValue({ interest:"Front & Rear Fan Kit" }), 829.99);
assert.strictEqual(baselineOpportunityValue({ interest:"Programming & Remote Assist" }), 199.99);
assert.strictEqual(baselineOpportunityValue({ interest:"G2 Power Block" }), 249.99);
assert.strictEqual(baselineOpportunityValue({ interest:"Custom Project", estimatedMonthlyTotal:1875 }), 1875, "real estimate wins over baseline");

console.log("Lead intelligence tests passed");
