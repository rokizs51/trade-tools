import assert from "node:assert/strict";
import test from "node:test";

import { calculateBuyerConfidence, getConfidenceLevel } from "../dist/domain/buyers/index.js";

function makeVerification(overrides = {}) {
  return {
    status: "VERIFIED",
    companyIdentityVerified: true,
    targetCountryVerified: true,
    commodityRelationshipVerified: true,
    requestedBuyerRoleVerified: true,
    officialWebsiteVerified: true,
    publicContactVerified: true,
    multipleConsistentSources: true,
    rejectionReasons: [],
    notes: [],
    ...overrides,
  };
}

test("scores a fully verified candidate at high confidence", () => {
  const result = calculateBuyerConfidence(makeVerification());

  assert.deepEqual(result, {
    score: 100,
    level: "HIGH",
    isEligible: true,
    rejectionReasons: [],
  });
});

test("keeps an evidence-backed candidate without optional signals at medium confidence", () => {
  const result = calculateBuyerConfidence(makeVerification({
    officialWebsiteVerified: false,
    publicContactVerified: false,
    multipleConsistentSources: false,
  }));

  assert.equal(result.score, 75);
  assert.equal(result.level, "MEDIUM");
  assert.equal(result.isEligible, true);
});

test("makes missing mandatory evidence ineligible even when optional points are present", () => {
  const result = calculateBuyerConfidence(makeVerification({
    requestedBuyerRoleVerified: false,
  }));

  assert.equal(result.score, 75);
  assert.equal(result.level, "LOW");
  assert.equal(result.isEligible, false);
  assert.match(result.rejectionReasons.join(" "), /buyer role/i);
});

test("preserves explicit verifier rejection reasons without duplicates", () => {
  const result = calculateBuyerConfidence(makeVerification({
    status: "REJECTED",
    targetCountryVerified: false,
    rejectionReasons: [
      "Target-country evidence is missing or contradictory.",
      "Target-country evidence is missing or contradictory.",
    ],
  }));

  assert.equal(result.isEligible, false);
  assert.equal(result.level, "LOW");
  assert.equal(result.rejectionReasons.length, 1);
});

test("confidence level boundaries remain deterministic", () => {
  assert.equal(getConfidenceLevel(54), "LOW");
  assert.equal(getConfidenceLevel(55), "MEDIUM");
  assert.equal(getConfidenceLevel(79), "MEDIUM");
  assert.equal(getConfidenceLevel(80), "HIGH");
  assert.equal(getConfidenceLevel(100, false), "LOW");
});
