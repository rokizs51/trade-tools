export const BUYER_TYPES = [
  "IMPORTER",
  "DISTRIBUTOR",
  "WHOLESALER",
  "PROCESSOR",
  "MANUFACTURER",
  "RETAILER",
] as const;

export type BuyerType = (typeof BUYER_TYPES)[number];

export const SEARCH_RUN_STATUSES = [
  "QUEUED",
  "PLANNING",
  "RESEARCHING",
  "VERIFYING",
  "SAVING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
] as const;

export type SearchRunStatus = (typeof SEARCH_RUN_STATUSES)[number];

export const CANDIDATE_REVIEW_STATUSES = ["NEW", "APPROVED", "REJECTED"] as const;

export type CandidateReviewStatus = (typeof CANDIDATE_REVIEW_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const EVIDENCE_TYPES = [
  "COMPANY_IDENTITY",
  "LOCATION",
  "COMMODITY",
  "BUYER_ROLE",
  "CONTACT",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const CONTACT_TYPES = ["EMAIL", "PHONE", "CONTACT_PAGE"] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

export const VERIFICATION_STATUSES = ["VERIFIED", "NEEDS_REVIEW", "REJECTED"] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface BuyerSearchInput {
  commodity: string;
  targetCountry: string;
  buyerTypes: BuyerType[];
  resultLimit: number;
  hsCode?: string | undefined;
  targetArea?: string | undefined;
  originCountry?: string | undefined;
  aliases?: string[] | undefined;
  productDetails?: string | undefined;
  exclusions?: string[] | undefined;
  requireWebsite?: boolean | undefined;
  requireContact?: boolean | undefined;
}

export interface BuyerSearchPlan {
  normalizedCommodity: string;
  commodityAliases: string[];
  localLanguageTerms: string[];
  targetCountry: string;
  targetArea?: string;
  buyerTypes: BuyerType[];
  searchQueries: string[];
  exclusions: string[];
  evidenceRequirements: string[];
}

export interface EvidenceSource {
  url: string;
  title: string;
  publisher?: string;
  retrievedAt: string;
  evidenceType: EvidenceType;
  excerpt?: string;
}

export interface CandidateContact {
  type: ContactType;
  value: string;
  label?: string;
  sourceUrl: string;
  isPublicBusinessContact: true;
}

export interface ResearchCandidate {
  companyName: string;
  country: string;
  countryCode?: string;
  city?: string;
  address?: string;
  websiteUrl?: string;
  buyerTypes: BuyerType[];
  commodityRelationship: string;
  contacts: CandidateContact[];
  evidence: EvidenceSource[];
}

export interface CandidateVerification {
  status: VerificationStatus;
  companyIdentityVerified: boolean;
  targetCountryVerified: boolean;
  commodityRelationshipVerified: boolean;
  requestedBuyerRoleVerified: boolean;
  officialWebsiteVerified: boolean;
  publicContactVerified: boolean;
  multipleConsistentSources: boolean;
  rejectionReasons: string[];
  notes: string[];
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  isEligible: boolean;
  rejectionReasons: string[];
}

export interface ScoredBuyerCandidate {
  candidate: ResearchCandidate;
  verification: CandidateVerification;
  confidence: ConfidenceResult;
  reviewStatus: CandidateReviewStatus;
}

export interface PossibleDuplicate {
  firstIndex: number;
  secondIndex: number;
  reason: "SIMILAR_NAME_AND_LOCATION";
  similarity: number;
}

export interface DeduplicationResult {
  candidates: ResearchCandidate[];
  mergedCount: number;
  possibleDuplicates: PossibleDuplicate[];
}
