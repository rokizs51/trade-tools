import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBuyerFallbackPlan,
  hasMaterialBuyerEvidenceImprovement,
  selectBuyerRepairCandidates,
} from "../dist/application/buyerDiscovery/index.js";

const input = {
  commodity: "Semi-husked coconut",
  targetCountry: "United Arab Emirates",
  targetArea: "Dubai",
  buyerTypes: ["IMPORTER", "DISTRIBUTOR"],
  resultLimit: 10,
  exclusions: ["Excluded Trading"],
};

const plan = {
  normalizedCommodity: "semi-husked coconut",
  commodityAliases: ["semi husked coconut"],
  localLanguageTerms: [],
  targetCountry: input.targetCountry,
  targetArea: input.targetArea,
  buyerTypes: input.buyerTypes,
  searchQueries: ["semi-husked coconut importer UAE"],
  exclusions: input.exclusions,
  evidenceRequirements: ["Direct evidence"],
};

const rejectedVerification = {
  status: "REJECTED",
  companyIdentityVerified: true,
  targetCountryVerified: true,
  commodityRelationshipVerified: true,
  requestedBuyerRoleVerified: false,
  officialWebsiteVerified: true,
  publicContactVerified: false,
  multipleConsistentSources: true,
  rejectionReasons: ["Requested buyer role is not supported."],
  notes: [],
};

function candidate(name = "Repairable Foods", country = "United Arab Emirates") {
  return {
    companyName: name,
    country,
    countryCode: country === "United Arab Emirates" ? "AE" : "US",
    websiteUrl: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example`,
    buyerTypes: ["IMPORTER"],
    commodityRelationship: "Handles semi-husked coconut.",
    contacts: [],
    evidence: [
      evidence("COMPANY_IDENTITY", "about"),
      evidence("LOCATION", "location"),
      evidence("COMMODITY", "products"),
    ],
  };
}

function evidence(evidenceType, suffix) {
  return {
    url: `https://repairable.example/${suffix}`,
    title: suffix,
    retrievedAt: "2026-09-20T00:00:00.000Z",
    evidenceType,
  };
}

test("fallback selects only grounded near-misses that preserve country, role, and exclusions", () => {
  const repairable = candidate();
  const wrongCountry = candidate("Wrong Country Foods", "United States");
  const excluded = candidate("Excluded Trading");
  const missingIdentity = candidate("Unknown Foods");
  missingIdentity.evidence = missingIdentity.evidence.filter((source) => source.evidenceType !== "COMPANY_IDENTITY");

  const selected = selectBuyerRepairCandidates(input, [repairable, wrongCountry, excluded, missingIdentity].map((item) => ({
    candidate: item,
    verification: rejectedVerification,
    isEligible: false,
  })), 10);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].candidate.companyName, "Repairable Foods");
  assert.deepEqual(selected[0].missingEvidenceTypes, ["BUYER_ROLE"]);
});

test("fallback plan is bounded and keeps immutable user criteria", () => {
  const [repair] = selectBuyerRepairCandidates(input, [{
    candidate: candidate(),
    verification: rejectedVerification,
    isEligible: false,
  }], 10);

  const fallback = buildBuyerFallbackPlan(input, plan, [repair], 2);
  assert.ok(fallback);
  assert.equal(fallback.searchQueries.length <= 2, true);
  assert.equal(fallback.targetCountry, input.targetCountry);
  assert.equal(fallback.targetArea, input.targetArea);
  assert.deepEqual(fallback.buyerTypes, input.buyerTypes);
  assert.deepEqual(fallback.exclusions, input.exclusions);
  assert.match(fallback.searchQueries[0], /Repairable Foods/);
  assert.match(fallback.searchQueries[0], /importer OR distributor/);
});

test("fallback re-verifies only materially improved evidence", () => {
  const original = candidate();
  const unchanged = structuredClone(original);
  const improved = structuredClone(original);
  improved.evidence.push(evidence("BUYER_ROLE", "imports"));

  assert.equal(hasMaterialBuyerEvidenceImprovement(original, unchanged, input), false);
  assert.equal(hasMaterialBuyerEvidenceImprovement(original, improved, input), true);
  assert.equal(hasMaterialBuyerEvidenceImprovement(undefined, improved, input), true);
});
