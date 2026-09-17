import assert from "node:assert/strict";
import test from "node:test";

import {
  BuyerSearchInputSchema,
  CandidateContactSchema,
  CandidateVerificationSchema,
  ResearchCandidateSchema,
} from "../dist/domain/buyers/index.js";
import { buyerFinderEvaluations } from "./fixtures/buyerFinderEvaluations.mjs";

const source = {
  url: "https://example.com/products/coconut",
  title: "Coconut products",
  publisher: "Example Trading",
  retrievedAt: "2026-09-17T04:00:00.000Z",
  evidenceType: "COMMODITY",
  excerpt: "The company imports and distributes coconut products.",
};

test("buyer search input applies a default result limit", () => {
  const parsed = BuyerSearchInputSchema.parse({
    commodity: "  Semi-husked coconut  ",
    targetCountry: "United Arab Emirates",
    buyerTypes: ["IMPORTER"],
  });

  assert.equal(parsed.commodity, "Semi-husked coconut");
  assert.equal(parsed.resultLimit, 10);
});

test("buyer search input rejects missing roles and excessive result limits", () => {
  assert.equal(BuyerSearchInputSchema.safeParse({
    commodity: "Coffee",
    targetCountry: "Germany",
    buyerTypes: [],
    resultLimit: 10,
  }).success, false);

  assert.equal(BuyerSearchInputSchema.safeParse({
    commodity: "Coffee",
    targetCountry: "Germany",
    buyerTypes: ["IMPORTER"],
    resultLimit: 26,
  }).success, false);
});

test("buyer search input validates HS-code shape", () => {
  assert.equal(BuyerSearchInputSchema.safeParse({
    commodity: "Desiccated coconut",
    targetCountry: "Singapore",
    buyerTypes: ["IMPORTER"],
    resultLimit: 10,
    hsCode: "0801.11",
  }).success, true);

  assert.equal(BuyerSearchInputSchema.safeParse({
    commodity: "Desiccated coconut",
    targetCountry: "Singapore",
    buyerTypes: ["IMPORTER"],
    resultLimit: 10,
    hsCode: "not-an-hs-code",
  }).success, false);
});

test("contact schemas require valid sourced public business contacts", () => {
  assert.equal(CandidateContactSchema.safeParse({
    type: "EMAIL",
    value: "sales@example.com",
    sourceUrl: source.url,
    isPublicBusinessContact: true,
  }).success, true);

  assert.equal(CandidateContactSchema.safeParse({
    type: "EMAIL",
    value: "firstname at example dot com",
    sourceUrl: source.url,
    isPublicBusinessContact: true,
  }).success, false);

  assert.equal(CandidateContactSchema.safeParse({
    type: "EMAIL",
    value: "sales@example.com",
    sourceUrl: source.url,
    isPublicBusinessContact: false,
  }).success, false);
});

test("candidate contacts must reference retained evidence", () => {
  const result = ResearchCandidateSchema.safeParse({
    companyName: "Example Trading LLC",
    country: "United Arab Emirates",
    countryCode: "ae",
    websiteUrl: "https://example.com",
    buyerTypes: ["IMPORTER"],
    commodityRelationship: "Imports coconut products.",
    contacts: [{
      type: "EMAIL",
      value: "sales@example.com",
      sourceUrl: "https://example.com/contact",
      isPublicBusinessContact: true,
    }],
    evidence: [source],
  });

  assert.equal(result.success, false);
});

test("candidate verification rejects unknown output fields", () => {
  const result = CandidateVerificationSchema.safeParse({
    status: "VERIFIED",
    companyIdentityVerified: true,
    targetCountryVerified: true,
    commodityRelationshipVerified: true,
    requestedBuyerRoleVerified: true,
    officialWebsiteVerified: true,
    publicContactVerified: false,
    multipleConsistentSources: true,
    rejectionReasons: [],
    notes: [],
    inventedField: "not permitted",
  });

  assert.equal(result.success, false);
});

test("all initial buyer-finder evaluation inputs satisfy the input contract", () => {
  for (const evaluation of buyerFinderEvaluations) {
    const result = BuyerSearchInputSchema.safeParse(evaluation.input);
    assert.equal(result.success, true, `${evaluation.id} should be a valid evaluation input`);
  }
});
