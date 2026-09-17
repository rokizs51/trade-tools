import {
  extractCanonicalDomain,
  normalizeCompanyName,
  normalizeSearchText,
  normalizeSourceUrl,
} from "./normalize.js";
import type {
  CandidateContact,
  DeduplicationResult,
  EvidenceSource,
  PossibleDuplicate,
  ResearchCandidate,
} from "./types.js";

export function deduplicateBuyerCandidates(input: ResearchCandidate[]): DeduplicationResult {
  const candidates: ResearchCandidate[] = [];
  let mergedCount = 0;

  for (const candidate of input) {
    const existingIndex = candidates.findIndex((existing) => isDefiniteDuplicate(existing, candidate));

    if (existingIndex === -1) {
      candidates.push(cloneCandidate(candidate));
      continue;
    }

    const existing = candidates[existingIndex];

    if (!existing) {
      throw new Error("Deduplication index resolved without a candidate.");
    }

    candidates[existingIndex] = mergeCandidates(existing, candidate);
    mergedCount += 1;
  }

  return {
    candidates,
    mergedCount,
    possibleDuplicates: findPossibleDuplicates(candidates),
  };
}

export function calculateNameSimilarity(first: string, second: string): number {
  const normalizedFirst = normalizeCompanyName(first);
  const normalizedSecond = normalizeCompanyName(second);

  if (!normalizedFirst || !normalizedSecond) {
    return 0;
  }

  if (normalizedFirst === normalizedSecond) {
    return 1;
  }

  const longestLength = Math.max(normalizedFirst.length, normalizedSecond.length);
  return 1 - levenshteinDistance(normalizedFirst, normalizedSecond) / longestLength;
}

function isDefiniteDuplicate(first: ResearchCandidate, second: ResearchCandidate): boolean {
  const firstDomain = extractCanonicalDomain(first.websiteUrl);
  const secondDomain = extractCanonicalDomain(second.websiteUrl);

  if (firstDomain && secondDomain && firstDomain === secondDomain) {
    return true;
  }

  return (
    normalizeCompanyName(first.companyName) === normalizeCompanyName(second.companyName) &&
    normalizeSearchText(first.country) === normalizeSearchText(second.country)
  );
}

function findPossibleDuplicates(candidates: ResearchCandidate[]): PossibleDuplicate[] {
  const possibleDuplicates: PossibleDuplicate[] = [];

  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const first = candidates[firstIndex];
      const second = candidates[secondIndex];

      if (!first || !second || normalizeSearchText(first.country) !== normalizeSearchText(second.country)) {
        continue;
      }

      const similarity = calculateNameSimilarity(first.companyName, second.companyName);
      const sameCity = Boolean(
        first.city && second.city && normalizeSearchText(first.city) === normalizeSearchText(second.city),
      );
      const similarAddress = Boolean(
        first.address && second.address && calculateTextSimilarity(first.address, second.address) >= 0.8,
      );

      if (similarity >= 0.82 && (sameCity || similarAddress)) {
        possibleDuplicates.push({
          firstIndex,
          secondIndex,
          reason: "SIMILAR_NAME_AND_LOCATION",
          similarity: roundSimilarity(similarity),
        });
      }
    }
  }

  return possibleDuplicates;
}

function mergeCandidates(primary: ResearchCandidate, duplicate: ResearchCandidate): ResearchCandidate {
  const merged = cloneCandidate(primary);

  if (!merged.countryCode && duplicate.countryCode) {
    merged.countryCode = duplicate.countryCode;
  }

  if (!merged.city && duplicate.city) {
    merged.city = duplicate.city;
  }

  if (!merged.address && duplicate.address) {
    merged.address = duplicate.address;
  }

  if (!merged.websiteUrl && duplicate.websiteUrl) {
    merged.websiteUrl = duplicate.websiteUrl;
  }

  if (duplicate.commodityRelationship.length > merged.commodityRelationship.length) {
    merged.commodityRelationship = duplicate.commodityRelationship;
  }

  merged.buyerTypes = [...new Set([...merged.buyerTypes, ...duplicate.buyerTypes])];
  merged.contacts = mergeContacts(merged.contacts, duplicate.contacts);
  merged.evidence = mergeEvidence(merged.evidence, duplicate.evidence);

  return merged;
}

function cloneCandidate(candidate: ResearchCandidate): ResearchCandidate {
  return {
    ...candidate,
    buyerTypes: [...candidate.buyerTypes],
    contacts: candidate.contacts.map((contact) => ({ ...contact })),
    evidence: candidate.evidence.map((source) => ({ ...source })),
  };
}

function mergeContacts(first: CandidateContact[], second: CandidateContact[]): CandidateContact[] {
  const seen = new Set<string>();
  const contacts: CandidateContact[] = [];

  for (const contact of [...first, ...second]) {
    const key = `${contact.type}:${normalizeSearchText(contact.value)}`;

    if (!seen.has(key)) {
      seen.add(key);
      contacts.push({ ...contact });
    }
  }

  return contacts;
}

function mergeEvidence(first: EvidenceSource[], second: EvidenceSource[]): EvidenceSource[] {
  const seen = new Set<string>();
  const evidence: EvidenceSource[] = [];

  for (const source of [...first, ...second]) {
    const normalizedUrl = normalizeSourceUrl(source.url) ?? source.url;
    const key = `${normalizedUrl}:${source.evidenceType}`;

    if (!seen.has(key)) {
      seen.add(key);
      evidence.push({ ...source });
    }
  }

  return evidence;
}

function calculateTextSimilarity(first: string, second: string): number {
  const normalizedFirst = normalizeSearchText(first);
  const normalizedSecond = normalizeSearchText(second);
  const longestLength = Math.max(normalizedFirst.length, normalizedSecond.length);

  if (longestLength === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(normalizedFirst, normalizedSecond) / longestLength;
}

function levenshteinDistance(first: string, second: string): number {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      const insertion = (current[secondIndex - 1] ?? 0) + 1;
      const deletion = (previous[secondIndex] ?? 0) + 1;
      const substitution = (previous[secondIndex - 1] ?? 0) + substitutionCost;
      current[secondIndex] = Math.min(insertion, deletion, substitution);
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[second.length] ?? 0;
}

function roundSimilarity(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
