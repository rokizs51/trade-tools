import type { CandidateVerification, ConfidenceLevel, ConfidenceResult } from "./types.js";

export const BUYER_CONFIDENCE_POINTS = {
  targetCountry: 20,
  commodityRelationship: 30,
  requestedBuyerRole: 25,
  officialWebsite: 10,
  publicContact: 10,
  multipleConsistentSources: 5,
} as const;

export function calculateBuyerConfidence(verification: CandidateVerification): ConfidenceResult {
  let score = 0;
  const mandatoryRejections: string[] = [];

  if (verification.targetCountryVerified) {
    score += BUYER_CONFIDENCE_POINTS.targetCountry;
  } else {
    mandatoryRejections.push("Target-country evidence is missing or contradictory.");
  }

  if (verification.commodityRelationshipVerified) {
    score += BUYER_CONFIDENCE_POINTS.commodityRelationship;
  } else {
    mandatoryRejections.push("Commodity relationship is not supported.");
  }

  if (verification.requestedBuyerRoleVerified) {
    score += BUYER_CONFIDENCE_POINTS.requestedBuyerRole;
  } else {
    mandatoryRejections.push("Requested buyer role is not supported.");
  }

  if (!verification.companyIdentityVerified) {
    mandatoryRejections.push("Company identity is not sufficiently established.");
  }

  if (verification.officialWebsiteVerified) {
    score += BUYER_CONFIDENCE_POINTS.officialWebsite;
  }

  if (verification.publicContactVerified) {
    score += BUYER_CONFIDENCE_POINTS.publicContact;
  }

  if (verification.multipleConsistentSources) {
    score += BUYER_CONFIDENCE_POINTS.multipleConsistentSources;
  }

  const rejectionReasons = uniqueStrings([...verification.rejectionReasons, ...mandatoryRejections]);
  const isEligible = verification.status !== "REJECTED" && mandatoryRejections.length === 0;

  return {
    score,
    level: getConfidenceLevel(score, isEligible),
    isEligible,
    rejectionReasons,
  };
}

export function getConfidenceLevel(score: number, isEligible = true): ConfidenceLevel {
  if (!isEligible || score < 55) {
    return "LOW";
  }

  if (score >= 80) {
    return "HIGH";
  }

  return "MEDIUM";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
