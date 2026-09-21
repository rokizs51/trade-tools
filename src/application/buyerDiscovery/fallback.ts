import {
  extractCanonicalDomain,
  normalizeCompanyName,
  normalizeCountryCode,
  normalizeSearchText,
  normalizeSourceUrl,
} from "../../domain/buyers/normalize.js";
import type {
  BuyerSearchInput,
  BuyerSearchPlan,
  CandidateVerification,
  EvidenceType,
  ResearchCandidate,
} from "../../domain/buyers/types.js";

export const MANDATORY_BUYER_EVIDENCE_TYPES = [
  "COMPANY_IDENTITY",
  "LOCATION",
  "COMMODITY",
  "BUYER_ROLE",
] as const satisfies readonly EvidenceType[];

export type MandatoryBuyerEvidenceType = (typeof MANDATORY_BUYER_EVIDENCE_TYPES)[number];

export interface EvaluatedFallbackCandidate {
  candidate: ResearchCandidate;
  verification: CandidateVerification;
  isEligible: boolean;
}

export interface BuyerRepairCandidate {
  candidate: ResearchCandidate;
  missingEvidenceTypes: MandatoryBuyerEvidenceType[];
  missingWebsite: boolean;
  missingContact: boolean;
}

export function selectBuyerRepairCandidates(
  input: BuyerSearchInput,
  evaluated: readonly EvaluatedFallbackCandidate[],
  maximumCandidates: number,
): BuyerRepairCandidate[] {
  return evaluated
    .filter((item) => !item.isEligible)
    .map((item) => classifyBuyerRepairCandidate(input, item))
    .filter((item): item is BuyerRepairCandidate => item !== undefined)
    .sort((first, second) => repairPriority(second) - repairPriority(first))
    .slice(0, maximumCandidates);
}

export function buildBuyerFallbackPlan(
  input: BuyerSearchInput,
  approvedPlan: BuyerSearchPlan,
  repairCandidates: readonly BuyerRepairCandidate[],
  maximumQueries: number,
): BuyerSearchPlan | undefined {
  const queries: string[] = [];

  for (const repair of repairCandidates) {
    const companyName = quoteSearchTerm(repair.candidate.companyName);
    const commodity = quoteSearchTerm(input.commodity);
    const country = quoteSearchTerm(input.targetCountry);
    const roles = input.buyerTypes.map(formatBuyerTypeForSearch).join(" OR ");
    const domain = extractCanonicalDomain(repair.candidate.websiteUrl);

    if (repair.missingEvidenceTypes.includes("BUYER_ROLE")) {
      pushUniqueQuery(queries, `${companyName} ${commodity} (${roles}) ${country}`);
    }

    if (repair.missingEvidenceTypes.includes("LOCATION")) {
      pushUniqueQuery(queries, `${companyName} ${country} office address company`);
    }

    if (repair.missingEvidenceTypes.includes("COMMODITY")) {
      pushUniqueQuery(queries, `${companyName} ${commodity} products`);
    }

    if (repair.missingWebsite) {
      pushUniqueQuery(queries, `${companyName} official website ${country}`);
    }

    if (repair.missingContact) {
      pushUniqueQuery(queries, `${companyName} official contact ${country}`);
    }

    if (domain && queries.length < maximumQueries) {
      const missingTerms = repair.missingEvidenceTypes.map(formatEvidenceTypeForSearch).join(" ");
      pushUniqueQuery(queries, `site:${domain} ${commodity} ${missingTerms || roles}`);
    }

    if (queries.length >= maximumQueries) break;
  }

  const boundedQueries = queries.slice(0, maximumQueries);
  if (boundedQueries.length === 0) return undefined;

  return {
    normalizedCommodity: approvedPlan.normalizedCommodity,
    commodityAliases: [...approvedPlan.commodityAliases],
    localLanguageTerms: [...approvedPlan.localLanguageTerms],
    targetCountry: input.targetCountry,
    ...(input.targetArea ? { targetArea: input.targetArea } : {}),
    buyerTypes: [...input.buyerTypes],
    searchQueries: boundedQueries,
    exclusions: [...new Set([...(approvedPlan.exclusions ?? []), ...(input.exclusions ?? [])])],
    evidenceRequirements: [
      "Return only grounded public evidence for the named companies and requested market.",
      "Preserve company identity, target-country, commodity, buyer-role, and contact provenance separately.",
      "Do not infer buyer activity or contact information when direct evidence is absent.",
    ],
  };
}

export function hasMaterialBuyerEvidenceImprovement(
  previous: ResearchCandidate | undefined,
  next: ResearchCandidate,
  input: BuyerSearchInput,
): boolean {
  if (!previous) return true;

  const previousTypes = new Set(previous.evidence.map((source) => source.evidenceType));
  const addedMandatoryType = MANDATORY_BUYER_EVIDENCE_TYPES.some(
    (type) => !previousTypes.has(type) && next.evidence.some((source) => source.evidenceType === type),
  );
  if (addedMandatoryType) return true;

  const previousSources = uniqueSourceCount(previous);
  const nextSources = uniqueSourceCount(next);
  if (nextSources > previousSources) return true;

  if (input.requireWebsite && !previous.websiteUrl && Boolean(next.websiteUrl)) return true;
  if (input.requireContact && previous.contacts.length === 0 && next.contacts.length > 0) return true;

  return false;
}

export function buyerCandidateIdentityKey(candidate: ResearchCandidate): string {
  const domain = extractCanonicalDomain(candidate.websiteUrl);
  if (domain) return `domain:${domain}`;

  const country = normalizeCountryCode(candidate.countryCode ?? candidate.country)
    ?? normalizeSearchText(candidate.country);
  return `name:${normalizeCompanyName(candidate.companyName)}:${country}`;
}

export function getMissingBuyerEvidenceTypes(
  candidate: ResearchCandidate,
): MandatoryBuyerEvidenceType[] {
  const present = new Set(candidate.evidence.map((source) => source.evidenceType));
  return MANDATORY_BUYER_EVIDENCE_TYPES.filter((type) => !present.has(type));
}

export function buyerCandidateConflictsWithCountry(
  input: BuyerSearchInput,
  candidate: ResearchCandidate,
): boolean {
  const targetCode = normalizeCountryCode(input.targetCountry);
  const candidateCode = normalizeCountryCode(candidate.countryCode ?? candidate.country);
  return targetCode && candidateCode
    ? targetCode !== candidateCode
    : normalizeSearchText(input.targetCountry) !== normalizeSearchText(candidate.country);
}

export function buyerCandidateMatchesExclusion(
  input: BuyerSearchInput,
  candidate: ResearchCandidate,
): boolean {
  const searchable = [
    normalizeSearchText(candidate.companyName),
    normalizeCompanyName(candidate.companyName),
    normalizeSearchText(candidate.websiteUrl ?? ""),
    extractCanonicalDomain(candidate.websiteUrl) ?? "",
  ];

  return (input.exclusions ?? []).some((value) => {
    const exclusion = normalizeSearchText(value);
    return exclusion.length > 0 && searchable.some((field) => field === exclusion || field.includes(exclusion));
  });
}

function classifyBuyerRepairCandidate(
  input: BuyerSearchInput,
  evaluated: EvaluatedFallbackCandidate,
): BuyerRepairCandidate | undefined {
  const { candidate, verification } = evaluated;
  const evidenceTypes = new Set(candidate.evidence.map((source) => source.evidenceType));
  const missingEvidenceTypes = getMissingBuyerEvidenceTypes(candidate);
  const matchingRole = candidate.buyerTypes.some((type) => input.buyerTypes.includes(type));
  const missingWebsite = Boolean(input.requireWebsite && !candidate.websiteUrl);
  const missingContact = Boolean(input.requireContact && candidate.contacts.length === 0);

  if (!evidenceTypes.has("COMPANY_IDENTITY")) return undefined;
  if (buyerCandidateConflictsWithCountry(input, candidate)) return undefined;
  if (buyerCandidateMatchesExclusion(input, candidate)) return undefined;
  if (!matchingRole) return undefined;
  if (missingEvidenceTypes.includes("COMPANY_IDENTITY")) return undefined;
  if (missingEvidenceTypes.length > 2) return undefined;

  const hasRepairableGap = missingEvidenceTypes.length > 0 || missingWebsite || missingContact;
  if (!hasRepairableGap) return undefined;

  // A rejection with no concrete evidence or explicit-filter gap is terminal rather than something
  // the fallback should repeatedly second-guess.
  if (verification.status === "REJECTED" && !hasRepairableGap) return undefined;

  return { candidate, missingEvidenceTypes, missingWebsite, missingContact };
}

function repairPriority(candidate: BuyerRepairCandidate): number {
  const supportedMandatory = MANDATORY_BUYER_EVIDENCE_TYPES.length - candidate.missingEvidenceTypes.length;
  return supportedMandatory * 100
    + uniqueSourceCount(candidate.candidate) * 10
    + (candidate.candidate.websiteUrl ? 2 : 0)
    + (candidate.candidate.contacts.length > 0 ? 1 : 0);
}

function uniqueSourceCount(candidate: ResearchCandidate): number {
  return new Set(
    candidate.evidence
      .map((source) => normalizeSourceUrl(source.url))
      .filter((url): url is string => Boolean(url)),
  ).size;
}

function pushUniqueQuery(queries: string[], query: string): void {
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (normalized && !queries.includes(normalized)) queries.push(normalized);
}

function quoteSearchTerm(value: string): string {
  return `"${value.replaceAll('"', "").trim()}"`;
}

function formatBuyerTypeForSearch(value: string): string {
  return value.toLocaleLowerCase("en").replaceAll("_", " ");
}

function formatEvidenceTypeForSearch(value: MandatoryBuyerEvidenceType): string {
  switch (value) {
    case "COMPANY_IDENTITY": return "company profile";
    case "LOCATION": return "office address";
    case "COMMODITY": return "products";
    case "BUYER_ROLE": return "importer distributor buyer";
  }
}
