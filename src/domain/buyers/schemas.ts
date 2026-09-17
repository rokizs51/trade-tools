import { z } from "zod";

import {
  BUYER_TYPES,
  CANDIDATE_REVIEW_STATUSES,
  CONFIDENCE_LEVELS,
  CONTACT_TYPES,
  EVIDENCE_TYPES,
  SEARCH_RUN_STATUSES,
  VERIFICATION_STATUSES,
  type BuyerSearchInput,
} from "./types.js";

const nonEmptyText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => nonEmptyText(maximum).optional();
const stringList = (maximumItems: number, maximumLength: number) =>
  z.array(nonEmptyText(maximumLength)).max(maximumItems);

export const BuyerTypeSchema = z.enum(BUYER_TYPES);
export const SearchRunStatusSchema = z.enum(SEARCH_RUN_STATUSES);
export const CandidateReviewStatusSchema = z.enum(CANDIDATE_REVIEW_STATUSES);
export const ConfidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);
export const EvidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export const ContactTypeSchema = z.enum(CONTACT_TYPES);
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);

export const BuyerSearchInputSchema: z.ZodType<BuyerSearchInput> = z
  .object({
    commodity: nonEmptyText(120),
    targetCountry: nonEmptyText(100),
    buyerTypes: z.array(BuyerTypeSchema).min(1).max(BUYER_TYPES.length),
    resultLimit: z.number().int().min(1).max(25).default(10),
    hsCode: z
      .string()
      .trim()
      .regex(/^\d{4}(?:[.\s-]?\d{2}){0,3}$/, "HS code must contain 4 to 10 digits.")
      .optional(),
    targetArea: optionalText(100),
    originCountry: optionalText(100),
    aliases: stringList(10, 100).optional(),
    productDetails: optionalText(500),
    exclusions: stringList(20, 120).optional(),
    requireWebsite: z.boolean().optional(),
    requireContact: z.boolean().optional(),
  })
  .strict();

export const BuyerSearchPlanSchema = z
  .object({
    normalizedCommodity: nonEmptyText(120),
    commodityAliases: stringList(15, 100),
    localLanguageTerms: stringList(15, 100),
    targetCountry: nonEmptyText(100),
    targetArea: optionalText(100),
    buyerTypes: z.array(BuyerTypeSchema).min(1).max(BUYER_TYPES.length),
    searchQueries: stringList(10, 300).min(1),
    exclusions: stringList(20, 120),
    evidenceRequirements: stringList(12, 300).min(1),
  })
  .strict();

export const EvidenceSourceSchema = z
  .object({
    url: z.url().max(2_000),
    title: nonEmptyText(300),
    publisher: optionalText(200),
    retrievedAt: z.iso.datetime({ offset: true }),
    evidenceType: EvidenceTypeSchema,
    excerpt: optionalText(1_000),
  })
  .strict();

export const CandidateContactSchema = z
  .object({
    type: ContactTypeSchema,
    value: nonEmptyText(500),
    label: optionalText(100),
    sourceUrl: z.url().max(2_000),
    isPublicBusinessContact: z.literal(true),
  })
  .strict()
  .superRefine((contact, context) => {
    if (contact.type === "EMAIL" && !z.email().safeParse(contact.value).success) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Email contacts must contain a valid email address.",
      });
    }

    if (contact.type === "CONTACT_PAGE" && !z.url().safeParse(contact.value).success) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Contact-page contacts must contain a valid URL.",
      });
    }
  });

export const ResearchCandidateSchema = z
  .object({
    companyName: nonEmptyText(200),
    country: nonEmptyText(100),
    countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
    city: optionalText(120),
    address: optionalText(500),
    websiteUrl: z.url().max(2_000).optional(),
    buyerTypes: z.array(BuyerTypeSchema).min(1).max(BUYER_TYPES.length),
    commodityRelationship: nonEmptyText(1_000),
    contacts: z.array(CandidateContactSchema).max(20),
    evidence: z.array(EvidenceSourceSchema).min(1).max(50),
  })
  .strict()
  .superRefine((candidate, context) => {
    const evidenceUrls = new Set(candidate.evidence.map((source) => source.url));

    for (const [index, contact] of candidate.contacts.entries()) {
      if (!evidenceUrls.has(contact.sourceUrl)) {
        context.addIssue({
          code: "custom",
          path: ["contacts", index, "sourceUrl"],
          message: "Every contact must reference a candidate evidence URL.",
        });
      }
    }
  });

export const CandidateVerificationSchema = z
  .object({
    status: VerificationStatusSchema,
    companyIdentityVerified: z.boolean(),
    targetCountryVerified: z.boolean(),
    commodityRelationshipVerified: z.boolean(),
    requestedBuyerRoleVerified: z.boolean(),
    officialWebsiteVerified: z.boolean(),
    publicContactVerified: z.boolean(),
    multipleConsistentSources: z.boolean(),
    rejectionReasons: stringList(10, 300),
    notes: stringList(10, 500),
  })
  .strict();

export const ConfidenceResultSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    level: ConfidenceLevelSchema,
    isEligible: z.boolean(),
    rejectionReasons: stringList(10, 300),
  })
  .strict();

export const ScoredBuyerCandidateSchema = z
  .object({
    candidate: ResearchCandidateSchema,
    verification: CandidateVerificationSchema,
    confidence: ConfidenceResultSchema,
    reviewStatus: CandidateReviewStatusSchema,
  })
  .strict();
