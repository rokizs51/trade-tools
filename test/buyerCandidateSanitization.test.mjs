import assert from "node:assert/strict";
import test from "node:test";

import { BuyerCandidateBatchSchema, sanitizeBuyerCandidateBatchPayload } from "../dist/application/buyerDiscovery/schemas.js";
import { createBuyerResearcher, MAX_RESEARCH_TARGET_CANDIDATES } from "../dist/application/buyerDiscovery/researcher.js";

const retrievedAt = "2026-09-26T09:00:00.000Z";

function validEvidence(type) {
  return {
    url: `https://example.com/${type.toLocaleLowerCase()}`,
    title: `${type} source`,
    retrievedAt,
    evidenceType: type,
    excerpt: "Evidence excerpt",
  };
}

function validCandidate(name) {
  return {
    companyName: name,
    country: "Thailand",
    buyerTypes: ["IMPORTER"],
    commodityRelationship: "Imports coconut shell for charcoal production.",
    contacts: [],
    evidence: [validEvidence("COMPANY_IDENTITY"), validEvidence("LOCATION"), validEvidence("COMMODITY"), validEvidence("BUYER_ROLE")],
  };
}

test("empty-string optional fields are pruned and the candidate still validates", () => {
  const payload = {
    candidates: [
      {
        ...validCandidate("Good Company"),
        city: "",
        address: "   ",
        countryCode: "",
        contacts: [
          { type: "EMAIL", value: "sales@good.example", label: "", sourceUrl: "https://example.com/company_identity", isPublicBusinessContact: true },
          { type: "PHONE", value: "", label: "", sourceUrl: "https://example.com/company_identity", isPublicBusinessContact: true },
          { type: "CONTACT_PAGE", value: "not a url", label: "Page", sourceUrl: "https://example.com/company_identity", isPublicBusinessContact: true },
        ],
      },
    ],
  };

  const parsed = BuyerCandidateBatchSchema.parse(payload);

  assert.equal(parsed.candidates.length, 1);
  const candidate = parsed.candidates[0];
  assert.equal(candidate.city, undefined);
  assert.equal(candidate.address, undefined);
  assert.equal(candidate.contacts.length, 1);
  assert.equal(candidate.contacts[0].type, "EMAIL");
  assert.equal(candidate.contacts[0].label, undefined);
});

test("unrepairable candidates are dropped while valid siblings survive", () => {
  const payload = {
    candidates: [
      validCandidate("First Co"),
      { ...validCandidate("Broken Co"), commodityRelationship: "" },
      { ...validCandidate("No Evidence Co"), evidence: [] },
      "not an object",
      validCandidate("Last Co"),
    ],
  };

  const parsed = BuyerCandidateBatchSchema.parse(payload);

  assert.deepEqual(parsed.candidates.map((candidate) => candidate.companyName), ["First Co", "Last Co"]);
});

test("invalid evidence rows are discarded without discarding the candidate", () => {
  const payload = {
    candidates: [
      {
        ...validCandidate("Mixed Evidence Co"),
        evidence: [
          validEvidence("COMPANY_IDENTITY"),
          { url: "https://example.com/bad", title: "", retrievedAt, evidenceType: "LOCATION" },
          validEvidence("COMMODITY"),
        ],
      },
    ],
  };

  const parsed = BuyerCandidateBatchSchema.parse(payload);

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].evidence.length, 2);
});

test("non-object and candidate-free payloads pass through unchanged", () => {
  assert.deepEqual(sanitizeBuyerCandidateBatchPayload({ candidates: "nope" }), { candidates: "nope" });
  assert.equal(sanitizeBuyerCandidateBatchPayload("string"), "string");
});

async function captureCoverageContract(resultLimit) {
  let captured;
  const client = {
    async generateStructured() {
      throw new Error("not used");
    },
    async research(request) {
      captured = JSON.parse(request.input).coverageContract;
      return {
        data: { candidates: [] },
        metadata: {},
        researchText: "",
        sources: [],
        searchMetadata: {},
        formattingMetadata: {},
      };
    },
  };
  const researcher = createBuyerResearcher({ client, model: "m", formattingModel: "m", maxSearchCalls: 6, maxResultsPerSearch: 5 });
  await researcher.research(
    { commodity: "coconut", targetCountry: "Thailand", buyerTypes: ["IMPORTER"], resultLimit },
    { normalizedCommodity: "coconut", commodityAliases: [], localLanguageTerms: [], targetCountry: "Thailand", buyerTypes: ["IMPORTER"], searchQueries: ["q"], exclusions: [], evidenceRequirements: ["e"] },
    { signal: new AbortController().signal, retrievedAt },
  );
  return captured;
}

test("research coverage target is capped so high user result limits cannot pressure padding", async () => {
  assert.deepEqual(await captureCoverageContract(20), { minQualifiedCandidates: MAX_RESEARCH_TARGET_CANDIDATES, maxSearches: 6 });
  assert.equal((await captureCoverageContract(5)).minQualifiedCandidates, 5);
});
