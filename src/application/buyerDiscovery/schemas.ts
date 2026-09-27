import { z } from "zod";

import {
  CandidateContactSchema,
  EvidenceSourceSchema,
  ResearchCandidateSchema,
  isContactGrounded,
  normalizeEvidenceUrls,
} from "../../domain/buyers/schemas.js";
import type { ResearchCandidate } from "../../domain/buyers/types.js";

export interface BuyerCandidateBatch {
  candidates: ResearchCandidate[];
}

// Deterministic pre-validation repair for known mechanical formatter defects
// (empty-string placeholders, individually invalid contacts or evidence rows).
// Invalid parts are discarded, never weakened or invented; a candidate that is
// unrepairable is dropped instead of failing the whole validated batch.
export function sanitizeBuyerCandidateBatchPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const batch = value as Record<string, unknown>;
  if (!Array.isArray(batch.candidates)) {
    return value;
  }

  return {
    ...batch,
    candidates: batch.candidates
      .map((candidate) => pruneEmptyStrings(candidate))
      .flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const raw = candidate as Record<string, unknown>;
        const evidence = Array.isArray(raw.evidence)
          ? raw.evidence.filter(isValidPlainObject).filter((row) => EvidenceSourceSchema.safeParse(row).success)
          : raw.evidence;
        // Ground contacts against the evidence that actually survived pruning.
        // A contact citing a dropped or malformed evidence row is removed on its
        // own instead of failing the schema and deleting the whole candidate.
        const grounded = Array.isArray(raw.contacts)
          ? raw.contacts.filter(isValidPlainObject).filter((contact) => CandidateContactSchema.safeParse(contact).success)
          : raw.contacts;
        const evidenceUrls = Array.isArray(evidence)
          ? normalizeEvidenceUrls(evidence.map((row) => (row as { url?: string }).url ?? ""))
          : new Set<string>();
        const repaired = {
          ...raw,
          evidence,
          ...(Array.isArray(grounded)
            ? { contacts: grounded.filter((contact) => isContactGrounded((contact as { sourceUrl?: string }).sourceUrl ?? "", evidenceUrls)) }
            : {}),
        };
        return ResearchCandidateSchema.safeParse(repaired).success ? [repaired] : [];
      }),
  };
}

function pruneEmptyStrings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(pruneEmptyStrings);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => !(typeof entryValue === "string" && entryValue.trim() === ""))
      .map(([key, entryValue]) => [key, pruneEmptyStrings(entryValue)]),
  );
}

function isValidPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const BuyerCandidateBatchSchema = z.preprocess(
  sanitizeBuyerCandidateBatchPayload,
  z.object({
    candidates: z.array(ResearchCandidateSchema).max(25),
  }).strict(),
) as unknown as z.ZodType<BuyerCandidateBatch>;
