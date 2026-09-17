import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateNameSimilarity,
  deduplicateBuyerCandidates,
} from "../dist/domain/buyers/index.js";

function makeSource(url, evidenceType = "COMMODITY") {
  return {
    url,
    title: `Source for ${evidenceType}`,
    retrievedAt: "2026-09-17T04:00:00.000Z",
    evidenceType,
  };
}

function makeCandidate(overrides = {}) {
  return {
    companyName: "Al Noor Trading LLC",
    country: "United Arab Emirates",
    countryCode: "AE",
    city: "Dubai",
    address: "Market Road 10, Dubai",
    websiteUrl: "https://alnoor.example",
    buyerTypes: ["IMPORTER"],
    commodityRelationship: "Imports coconut products.",
    contacts: [],
    evidence: [makeSource("https://alnoor.example/coconut")],
    ...overrides,
  };
}

test("merges candidates with the same canonical website domain", () => {
  const result = deduplicateBuyerCandidates([
    makeCandidate(),
    makeCandidate({
      companyName: "Al Noor General Trading",
      websiteUrl: "http://www.alnoor.example/about",
      buyerTypes: ["DISTRIBUTOR"],
      commodityRelationship: "Imports and distributes semi-husked coconut across the UAE.",
      evidence: [makeSource("https://alnoor.example/about", "COMPANY_IDENTITY")],
    }),
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.mergedCount, 1);
  assert.deepEqual(result.candidates[0].buyerTypes, ["IMPORTER", "DISTRIBUTOR"]);
  assert.equal(result.candidates[0].evidence.length, 2);
  assert.match(result.candidates[0].commodityRelationship, /distributes/i);
});

test("merges exact normalized company names only within the same country", () => {
  const result = deduplicateBuyerCandidates([
    makeCandidate({ websiteUrl: undefined }),
    makeCandidate({ companyName: "Al Noor Trading L.L.C.", websiteUrl: undefined }),
    makeCandidate({ country: "Saudi Arabia", countryCode: "SA", websiteUrl: undefined }),
  ]);

  assert.equal(result.candidates.length, 2);
  assert.equal(result.mergedCount, 1);
});

test("flags similar names in the same city instead of automatically merging them", () => {
  const result = deduplicateBuyerCandidates([
    makeCandidate({ companyName: "Al Noor Foods Trading", websiteUrl: "https://alnoorfoods.example" }),
    makeCandidate({ companyName: "Al Noor Food Trading", websiteUrl: "https://alnoorfood.example" }),
  ]);

  assert.equal(result.candidates.length, 2);
  assert.equal(result.mergedCount, 0);
  assert.equal(result.possibleDuplicates.length, 1);
  assert.equal(result.possibleDuplicates[0].reason, "SIMILAR_NAME_AND_LOCATION");
});

test("does not mutate the supplied candidates while merging", () => {
  const first = makeCandidate();
  const second = makeCandidate({ buyerTypes: ["WHOLESALER"] });

  deduplicateBuyerCandidates([first, second]);

  assert.deepEqual(first.buyerTypes, ["IMPORTER"]);
  assert.deepEqual(second.buyerTypes, ["WHOLESALER"]);
});

test("name similarity ignores punctuation and common legal suffixes", () => {
  assert.equal(calculateNameSimilarity("Nusantara Foods Pte. Ltd.", "Nusantara Foods"), 1);
});
