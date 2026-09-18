export type EvaluationAnswer = "YES" | "NO" | "UNCLEAR";
export type EvaluationContactAnswer = "YES" | "NO" | "NOT_PRESENT";

export interface BuyerEvaluationCandidateAssessment {
  rank: number;
  companyName: string;
  sourceCount: number;
  contactCount: number;
  sourcedContactCount: number;
  relevant: boolean;
  correctCountry: boolean;
  buyerRoleSupported: EvaluationAnswer;
  commodityRelationshipSupported: boolean;
  companyIdentityEstablished: boolean;
  contactSourceValid: EvaluationContactAnswer;
  officialWebsiteIdentified: EvaluationAnswer;
  duplicate: boolean;
  unsupportedClaim: boolean;
}

export interface BuyerEvaluationRunAssessment {
  fixtureId: string;
  configurationId: string;
  requestedLimit: number;
  returnedCandidateCount: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  candidates: BuyerEvaluationCandidateAssessment[];
}

export interface BuyerEvaluationMetrics {
  runCount: number;
  reviewedCandidateCount: number;
  acceptedCandidateCount: number;
  lowEvidenceAbstentionCount: number;
  precisionAt5: number | null;
  precisionAt10: number | null;
  targetCountryAccuracy: number | null;
  buyerRoleAccuracy: number | null;
  evidenceCompleteness: number | null;
  contactAccuracy: number | null;
  sourceCoverage: number | null;
  contactProvenance: number | null;
  unsupportedClaimRate: number | null;
  duplicateRate: number | null;
  medianLatencyMs: number | null;
  medianCostUsd: number | null;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface BuyerEvaluationThresholdResult {
  passed: boolean;
  checks: {
    precisionAt10: boolean;
    targetCountryAccuracy: boolean;
    sourceCoverage: boolean;
    contactProvenance: boolean;
    unsupportedClaimRate: boolean;
    duplicateRate: boolean;
  };
}

const RELEASE_THRESHOLDS = {
  precisionAt10: 0.8,
  targetCountryAccuracy: 0.95,
  sourceCoverage: 1,
  contactProvenance: 1,
  unsupportedClaimRate: 0,
  duplicateRateExclusiveMaximum: 0.05,
} as const;

export function scoreBuyerEvaluationConfiguration(
  runs: BuyerEvaluationRunAssessment[],
): BuyerEvaluationMetrics {
  validateEvaluationRuns(runs);
  const candidates = runs.flatMap((run) => run.candidates);
  const contactReviewed = candidates.filter((candidate) => candidate.contactSourceValid !== "NOT_PRESENT");
  const contactCount = candidates.reduce((total, candidate) => total + candidate.contactCount, 0);
  const sourcedContactCount = candidates.reduce(
    (total, candidate) => total + candidate.sourcedContactCount,
    0,
  );

  return {
    runCount: runs.length,
    reviewedCandidateCount: candidates.length,
    acceptedCandidateCount: candidates.filter((candidate) => candidate.relevant).length,
    lowEvidenceAbstentionCount: runs.reduce(
      (total, run) => total + Math.max(0, run.requestedLimit - run.returnedCandidateCount),
      0,
    ),
    precisionAt5: average(runPrecision(runs, 5)),
    precisionAt10: average(runPrecision(runs, 10)),
    targetCountryAccuracy: ratio(candidates.filter((candidate) => candidate.correctCountry).length, candidates.length),
    buyerRoleAccuracy: ratio(
      candidates.filter((candidate) => candidate.buyerRoleSupported === "YES").length,
      candidates.length,
    ),
    evidenceCompleteness: ratio(
      candidates.filter((candidate) =>
        candidate.companyIdentityEstablished &&
        candidate.correctCountry &&
        candidate.commodityRelationshipSupported &&
        candidate.buyerRoleSupported === "YES",
      ).length,
      candidates.length,
    ),
    contactAccuracy: ratio(
      contactReviewed.filter((candidate) => candidate.contactSourceValid === "YES").length,
      contactReviewed.length,
    ),
    sourceCoverage: ratio(candidates.filter((candidate) => candidate.sourceCount > 0).length, candidates.length),
    contactProvenance: contactCount === 0 ? 1 : ratio(sourcedContactCount, contactCount),
    unsupportedClaimRate: ratio(candidates.filter((candidate) => candidate.unsupportedClaim).length, candidates.length),
    duplicateRate: ratio(candidates.filter((candidate) => candidate.duplicate).length, candidates.length),
    medianLatencyMs: median(runs.map((run) => run.latencyMs)),
    medianCostUsd: median(runs.map((run) => run.estimatedCostUsd)),
    totalCostUsd: sum(runs.map((run) => run.estimatedCostUsd)),
    inputTokens: sum(runs.map((run) => run.inputTokens)),
    outputTokens: sum(runs.map((run) => run.outputTokens)),
  };
}

export function evaluateBuyerReleaseThresholds(
  metrics: BuyerEvaluationMetrics,
): BuyerEvaluationThresholdResult {
  const checks = {
    precisionAt10: meetsMinimum(metrics.precisionAt10, RELEASE_THRESHOLDS.precisionAt10),
    targetCountryAccuracy: meetsMinimum(
      metrics.targetCountryAccuracy,
      RELEASE_THRESHOLDS.targetCountryAccuracy,
    ),
    sourceCoverage: meetsMinimum(metrics.sourceCoverage, RELEASE_THRESHOLDS.sourceCoverage),
    contactProvenance: meetsMinimum(metrics.contactProvenance, RELEASE_THRESHOLDS.contactProvenance),
    unsupportedClaimRate: metrics.unsupportedClaimRate === RELEASE_THRESHOLDS.unsupportedClaimRate,
    duplicateRate:
      metrics.duplicateRate !== null &&
      metrics.duplicateRate < RELEASE_THRESHOLDS.duplicateRateExclusiveMaximum,
  };

  return { passed: Object.values(checks).every(Boolean), checks };
}

function validateEvaluationRuns(runs: BuyerEvaluationRunAssessment[]): void {
  for (const run of runs) {
    if (!Number.isInteger(run.requestedLimit) || run.requestedLimit < 1) {
      throw new RangeError("Evaluation requestedLimit must be a positive integer.");
    }

    if (run.returnedCandidateCount !== run.candidates.length) {
      throw new Error(
        `Evaluation ${run.fixtureId}/${run.configurationId} must review every returned candidate.`,
      );
    }

    const ranks = run.candidates.map((candidate) => candidate.rank);
    if (new Set(ranks).size !== ranks.length || ranks.some((rank) => !Number.isInteger(rank) || rank < 1)) {
      throw new Error(`Evaluation ${run.fixtureId}/${run.configurationId} has invalid candidate ranks.`);
    }

    for (const candidate of run.candidates) {
      if (candidate.sourceCount < 0 || candidate.contactCount < 0 || candidate.sourcedContactCount < 0) {
        throw new RangeError("Evaluation evidence and contact counts cannot be negative.");
      }
      if (candidate.sourcedContactCount > candidate.contactCount) {
        throw new RangeError("Sourced contact count cannot exceed contact count.");
      }
    }
  }
}

function runPrecision(runs: BuyerEvaluationRunAssessment[], limit: number): number[] {
  return runs.flatMap((run) => {
    const candidates = [...run.candidates]
      .sort((first, second) => first.rank - second.rank)
      .slice(0, limit);
    return candidates.length === 0
      ? []
      : [candidates.filter((candidate) => candidate.relevant).length / candidates.length];
  });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) return null;
  if (sorted.length % 2 === 1) return middleValue;
  const previous = sorted[middle - 1];
  return previous === undefined ? middleValue : (previous + middleValue) / 2;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function meetsMinimum(value: number | null, minimum: number): boolean {
  return value !== null && value >= minimum;
}
