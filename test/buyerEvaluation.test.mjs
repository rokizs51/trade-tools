import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateBuyerReleaseThresholds,
  scoreBuyerEvaluationConfiguration,
} from "../dist/domain/buyers/index.js";

function candidate(rank, overrides = {}) {
  return {
    rank,
    companyName: `Candidate ${rank}`,
    sourceCount: 2,
    contactCount: 1,
    sourcedContactCount: 1,
    relevant: true,
    correctCountry: true,
    buyerRoleSupported: "YES",
    commodityRelationshipSupported: true,
    companyIdentityEstablished: true,
    contactSourceValid: "YES",
    officialWebsiteIdentified: "YES",
    duplicate: false,
    unsupportedClaim: false,
    ...overrides,
  };
}

function run(fixtureId, candidates, overrides = {}) {
  return {
    fixtureId,
    configurationId: "baseline",
    requestedLimit: 5,
    returnedCandidateCount: candidates.length,
    latencyMs: 1_000,
    inputTokens: 100,
    outputTokens: 50,
    estimatedCostUsd: 0.02,
    candidates,
    ...overrides,
  };
}

test("buyer evaluation aggregates quality, coverage, cost, and latency", () => {
  const metrics = scoreBuyerEvaluationConfiguration([
    run("one", [candidate(1), candidate(2)]),
    run("two", [
      candidate(1),
      candidate(2, {
        relevant: false,
        buyerRoleSupported: "NO",
        commodityRelationshipSupported: false,
        contactCount: 0,
        sourcedContactCount: 0,
        contactSourceValid: "NOT_PRESENT",
        unsupportedClaim: true,
      }),
    ], { latencyMs: 3_000, estimatedCostUsd: 0.04 }),
  ]);

  assert.equal(metrics.runCount, 2);
  assert.equal(metrics.reviewedCandidateCount, 4);
  assert.equal(metrics.acceptedCandidateCount, 3);
  assert.equal(metrics.lowEvidenceAbstentionCount, 6);
  assert.equal(metrics.precisionAt5, 0.75);
  assert.equal(metrics.precisionAt10, 0.75);
  assert.equal(metrics.buyerRoleAccuracy, 0.75);
  assert.equal(metrics.evidenceCompleteness, 0.75);
  assert.equal(metrics.contactAccuracy, 1);
  assert.equal(metrics.sourceCoverage, 1);
  assert.equal(metrics.contactProvenance, 1);
  assert.equal(metrics.unsupportedClaimRate, 0.25);
  assert.equal(metrics.medianLatencyMs, 2_000);
  assert.equal(metrics.medianCostUsd, 0.03);
  assert.equal(metrics.totalCostUsd, 0.06);
  assert.equal(metrics.inputTokens, 200);
  assert.equal(metrics.outputTokens, 100);
});

test("buyer evaluation release checks enforce the documented thresholds", () => {
  const passing = scoreBuyerEvaluationConfiguration([
    run("passing", Array.from({ length: 10 }, (_, index) => candidate(index + 1)), {
      requestedLimit: 10,
    }),
  ]);
  assert.deepEqual(evaluateBuyerReleaseThresholds(passing), {
    passed: true,
    checks: {
      precisionAt10: true,
      targetCountryAccuracy: true,
      sourceCoverage: true,
      contactProvenance: true,
      unsupportedClaimRate: true,
      duplicateRate: true,
    },
  });

  const failing = scoreBuyerEvaluationConfiguration([
    run("failing", [candidate(1, { relevant: false, duplicate: true })]),
  ]);
  assert.equal(evaluateBuyerReleaseThresholds(failing).passed, false);
});

test("buyer evaluation refuses partial review sets and invalid provenance counts", () => {
  assert.throws(
    () => scoreBuyerEvaluationConfiguration([
      run("partial", [candidate(1)], { returnedCandidateCount: 2 }),
    ]),
    /must review every returned candidate/,
  );

  assert.throws(
    () => scoreBuyerEvaluationConfiguration([
      run("invalid-contact", [candidate(1, { contactCount: 0, sourcedContactCount: 1 })]),
    ]),
    /cannot exceed contact count/,
  );
});
