import {
  BuyerSearchInputSchema,
} from "../../domain/buyers/schemas.js";
import {
  deduplicateBuyerCandidates,
} from "../../domain/buyers/deduplicate.js";
import {
  normalizeCountryCode,
  normalizeSearchText,
  normalizeSourceUrl,
} from "../../domain/buyers/normalize.js";
import { calculateBuyerConfidence } from "../../domain/buyers/scoring.js";
import type {
  BuyerSearchInput,
  CandidateVerification,
  ResearchCandidate,
  SearchRunStatus,
} from "../../domain/buyers/types.js";
import {
  BUYER_PLANNER_PROMPT_VERSION,
  BUYER_RESEARCH_PROMPT_VERSION,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../../agents/buyerFinder/prompts.js";
import type {
  ModelCallMetadata,
  ModelClient,
} from "../../infrastructure/ai/types.js";
import { BuyerDiscoveryBudgetExceededError, BuyerDiscoveryTimeoutError } from "./errors.js";
import { createBuyerResearcher } from "./researcher.js";
import { withBuyerDiscoveryRetry } from "./retry.js";
import { createBuyerSearchPlanner } from "./searchPlanner.js";
import { createBuyerCandidateVerifier } from "./verifier.js";

export interface BuyerDiscoveryModels {
  planner: string;
  research: string;
  formatter: string;
  verifier: string;
}

export interface BuyerDiscoveryLimits {
  maxSearchCalls: number;
  maxResultsPerSearch: number;
  maxRawCandidates: number;
  verificationConcurrency: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  timeoutMs: number;
  maxCostUsd?: number;
}

interface BuyerSearchJobContext {
  runId: string;
  signal: AbortSignal;
  transition(status: SearchRunStatus, changes?: Record<string, unknown>): unknown;
  updateProgress(progress: { current: number; total: number; stage?: string }): unknown;
  updateTelemetry(telemetry: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: string;
    modelConfig: Record<string, unknown>;
  }): unknown;
}

interface BuyerPersistenceRepository {
  saveCandidateBundle(
    searchRunId: string,
    bundle: Record<string, unknown>,
    options: { now: string; createId: () => string },
  ): unknown;
}

export interface BuyerDiscoveryOrchestratorOptions {
  client: ModelClient;
  repository: BuyerPersistenceRepository;
  models: BuyerDiscoveryModels;
  limits: BuyerDiscoveryLimits;
  createId: () => string;
  now?: () => string;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface BuyerDiscoverySummary {
  researchedCandidateCount: number;
  deduplicatedCandidateCount: number;
  verifiedCandidateCount: number;
  savedCandidateCount: number;
  rejectedCandidateCount: number;
  savedMatchCount: number;
}

interface CallRecord {
  stage: "PLANNER" | "RESEARCH_SEARCH" | "RESEARCH_FORMATTING" | "VERIFIER";
  requestId: string;
  requestedModel: string;
  actualModel: string;
  provider?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export function createBuyerDiscoveryOrchestrator(options: BuyerDiscoveryOrchestratorOptions) {
  validateLimits(options.limits);

  const planner = createBuyerSearchPlanner({ client: options.client, model: options.models.planner });
  const researcher = createBuyerResearcher({
    client: options.client,
    model: options.models.research,
    formattingModel: options.models.formatter,
    maxSearchCalls: options.limits.maxSearchCalls,
    maxResultsPerSearch: options.limits.maxResultsPerSearch,
  });
  const verifier = createBuyerCandidateVerifier({ client: options.client, model: options.models.verifier });
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async run(rawInput: BuyerSearchInput, job: BuyerSearchJobContext): Promise<BuyerDiscoverySummary> {
      const input = BuyerSearchInputSchema.parse(rawInput);
      const runSignal = createRunSignal(job.signal, options.limits.timeoutMs);
      const telemetry = createTelemetryTracker(options.models, options.limits.maxCostUsd);

      function record(stage: CallRecord["stage"], metadata: ModelCallMetadata): void {
        if (telemetry.record(stage, metadata)) {
          job.updateTelemetry(telemetry.snapshot());
          telemetry.assertBudget();
        }
      }

      try {
        job.updateProgress({ current: 0, total: 1, stage: "Preparing search" });
        const planResult = await planner.plan(input, runSignal.signal);
        record("PLANNER", planResult.metadata);
        job.updateProgress({ current: 1, total: 1, stage: "Preparing search" });
        job.transition("RESEARCHING", {
          plan: planResult.data,
          modelConfig: telemetry.snapshot().modelConfig,
        });

        job.updateProgress({ current: 0, total: 1, stage: "Searching sources" });
        const retrievedAt = now();
        const researchResult = await withBuyerDiscoveryRetry(
          () => researcher.research(input, planResult.data, {
            signal: runSignal.signal,
            retrievedAt,
            onSearchComplete(searchResult) {
              record("RESEARCH_SEARCH", searchResult.metadata);
            },
          }),
          retryOptions(options, runSignal.signal),
        );
        record("RESEARCH_SEARCH", researchResult.searchMetadata);
        record("RESEARCH_FORMATTING", researchResult.formattingMetadata);
        job.updateProgress({ current: 1, total: 1, stage: "Searching sources" });

        const rawCandidates = retainGroundedCandidates(
          researchResult.data.candidates.slice(0, options.limits.maxRawCandidates),
          researchResult.sources.map((source) => source.url),
          retrievedAt,
        );
        const deduplicated = deduplicateBuyerCandidates(rawCandidates);
        const candidates = deduplicated.candidates.slice(0, input.resultLimit);
        job.transition("VERIFYING", {
          progressCurrent: 0,
          progressTotal: candidates.length,
          modelConfig: telemetry.snapshot().modelConfig,
        });

        let verifiedCandidateCount = 0;
        let savedCandidateCount = 0;
        let rejectedCandidateCount = 0;
        let savedMatchCount = 0;

        await mapWithConcurrency(
          candidates,
          options.limits.verificationConcurrency,
          runSignal.signal,
          async (candidate) => {
            const verificationResult = await withBuyerDiscoveryRetry(
              () => verifier.verify(input, candidate, runSignal.signal),
              retryOptions(options, runSignal.signal),
            );
            record("VERIFIER", verificationResult.metadata);

            const verification = enforceDeterministicRequirements(
              input,
              candidate,
              verificationResult.data,
            );
            const confidence = calculateBuyerConfidence(verification);
            verifiedCandidateCount += 1;

            if (confidence.isEligible) {
              const buyerTypes = candidate.buyerTypes.filter((type) => input.buyerTypes.includes(type));

              for (const buyerType of buyerTypes) {
                options.repository.saveCandidateBundle(job.runId, {
                  company: {
                    name: candidate.companyName,
                    websiteUrl: candidate.websiteUrl,
                    countryCode: candidate.countryCode,
                    countryName: candidate.country,
                    city: candidate.city,
                    address: candidate.address,
                  },
                  match: {
                    commodity: input.commodity,
                    buyerType,
                    commodityRelationship: candidate.commodityRelationship,
                    confidenceScore: confidence.score,
                    confidenceLevel: confidence.level,
                    verificationStatus: verification.status,
                    reviewStatus: "NEW",
                    rejectionReason: confidence.rejectionReasons.join(" ") || undefined,
                  },
                  sources: candidate.evidence,
                  contacts: candidate.contacts,
                }, {
                  now: now(),
                  createId: options.createId,
                });
                savedMatchCount += 1;
              }

              savedCandidateCount += 1;
            } else {
              rejectedCandidateCount += 1;
            }

            job.updateProgress({
              current: verifiedCandidateCount,
              total: candidates.length,
              stage: "Verifying candidates",
            });
          },
        );

        job.transition("SAVING", {
          progressCurrent: savedCandidateCount,
          progressTotal: candidates.length,
          modelConfig: telemetry.snapshot().modelConfig,
        });

        return {
          researchedCandidateCount: researchResult.data.candidates.length,
          deduplicatedCandidateCount: deduplicated.candidates.length,
          verifiedCandidateCount,
          savedCandidateCount,
          rejectedCandidateCount,
          savedMatchCount,
        };
      } finally {
        runSignal.cleanup();
      }
    },
  };
}

function retryOptions(options: BuyerDiscoveryOrchestratorOptions, signal: AbortSignal) {
  return {
    maxRetries: options.limits.maxRetries,
    baseDelayMs: options.limits.retryBaseDelayMs,
    signal,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.random ? { random: options.random } : {}),
  };
}

function createTelemetryTracker(models: BuyerDiscoveryModels, maximumCostUsd: number | undefined) {
  const calls: CallRecord[] = [];
  const recorded = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;

  return {
    record(stage: CallRecord["stage"], metadata: ModelCallMetadata): boolean {
      const key = `${stage}:${metadata.requestId}`;

      if (recorded.has(key)) {
        return false;
      }

      recorded.add(key);
      const usage = metadata.usage;
      inputTokens += usage?.inputTokens ?? 0;
      outputTokens += usage?.outputTokens ?? 0;
      estimatedCostUsd += usage?.costUsd ?? usage?.serverToolCostUsd ?? 0;
      calls.push({
        stage,
        requestId: metadata.requestId,
        requestedModel: metadata.requestedModel,
        actualModel: metadata.actualModel,
        ...(metadata.provider ? { provider: metadata.provider } : {}),
        latencyMs: metadata.latencyMs,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        ...(usage?.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      });

      return true;
    },

    assertBudget() {
      if (maximumCostUsd !== undefined && estimatedCostUsd > maximumCostUsd) {
        throw new BuyerDiscoveryBudgetExceededError(estimatedCostUsd, maximumCostUsd);
      }
    },

    snapshot() {
      return {
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimatedCostUsd.toFixed(8),
        modelConfig: {
          requestedModels: models,
          promptVersions: {
            planner: BUYER_PLANNER_PROMPT_VERSION,
            research: BUYER_RESEARCH_PROMPT_VERSION,
            verifier: BUYER_VERIFIER_PROMPT_VERSION,
          },
          calls: [...calls],
        },
      };
    },
  };
}

function enforceDeterministicRequirements(
  input: BuyerSearchInput,
  candidate: ResearchCandidate,
  proposed: CandidateVerification,
): CandidateVerification {
  const reasons = [...proposed.rejectionReasons];
  const matchingBuyerTypes = candidate.buyerTypes.filter((type) => input.buyerTypes.includes(type));
  const evidenceTypes = new Set(candidate.evidence.map((source) => source.evidenceType));
  const uniqueSourceUrls = new Set(candidate.evidence.map((source) => normalizeSourceUrl(source.url)));
  let companyIdentityVerified = proposed.companyIdentityVerified;
  let targetCountryVerified = proposed.targetCountryVerified;
  let commodityRelationshipVerified = proposed.commodityRelationshipVerified;
  let requestedBuyerRoleVerified = proposed.requestedBuyerRoleVerified;
  let officialWebsiteVerified = proposed.officialWebsiteVerified;
  let publicContactVerified = proposed.publicContactVerified;
  let multipleConsistentSources = proposed.multipleConsistentSources;
  let status = proposed.status;

  if (!evidenceTypes.has("COMPANY_IDENTITY")) {
    companyIdentityVerified = false;
    reasons.push("Company identity has no retained evidence source.");
  }

  if (!evidenceTypes.has("LOCATION")) {
    targetCountryVerified = false;
    reasons.push("Target-country presence has no retained evidence source.");
  }

  if (!evidenceTypes.has("COMMODITY")) {
    commodityRelationshipVerified = false;
    reasons.push("Commodity relationship has no retained evidence source.");
  }

  if (!evidenceTypes.has("BUYER_ROLE")) {
    requestedBuyerRoleVerified = false;
    reasons.push("Requested buyer role has no retained evidence source.");
  }

  if (!candidate.websiteUrl) {
    officialWebsiteVerified = false;
  }

  if (candidate.contacts.length === 0 || !evidenceTypes.has("CONTACT")) {
    publicContactVerified = false;
  }

  if (uniqueSourceUrls.size < 2) {
    multipleConsistentSources = false;
  }

  const targetCode = normalizeCountryCode(input.targetCountry);
  const candidateCode = normalizeCountryCode(candidate.countryCode ?? candidate.country);
  const countriesConflict = targetCode && candidateCode
    ? targetCode !== candidateCode
    : normalizeSearchText(input.targetCountry) !== normalizeSearchText(candidate.country);

  if (countriesConflict) {
    targetCountryVerified = false;
    status = "REJECTED";
    reasons.push("Candidate country conflicts with the requested target country.");
  }

  if (matchingBuyerTypes.length === 0) {
    requestedBuyerRoleVerified = false;
    status = "REJECTED";
    reasons.push("Candidate does not contain one of the requested buyer roles.");
  }

  if (input.requireWebsite && !candidate.websiteUrl) {
    status = "REJECTED";
    reasons.push("A public company website was required but not found.");
  }

  if (input.requireContact && candidate.contacts.length === 0) {
    status = "REJECTED";
    reasons.push("A public business contact was required but not found.");
  }

  return {
    ...proposed,
    status,
    companyIdentityVerified,
    targetCountryVerified,
    commodityRelationshipVerified,
    requestedBuyerRoleVerified,
    officialWebsiteVerified,
    publicContactVerified,
    multipleConsistentSources,
    rejectionReasons: [...new Set(reasons)],
  };
}

function retainGroundedCandidates(
  candidates: ResearchCandidate[],
  recoveredSourceUrls: string[],
  retrievedAt: string,
): ResearchCandidate[] {
  const recovered = new Set(
    recoveredSourceUrls
      .map((url) => normalizeSourceUrl(url))
      .filter((url): url is string => Boolean(url)),
  );

  return candidates
    .filter((candidate) => candidate.evidence.length > 0 && candidate.evidence.every((source) => {
      const normalized = normalizeSourceUrl(source.url);
      return normalized !== undefined && recovered.has(normalized);
    }))
    .map((candidate) => ({
      ...candidate,
      evidence: candidate.evidence.map((source) => ({ ...source, retrievedAt })),
    }));
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      if (item !== undefined) {
        await operation(item);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

function createRunSignal(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new BuyerDiscoveryTimeoutError(timeoutMs));
  }, timeoutMs);

  function forwardAbort() {
    controller.abort(parent.reason ?? new Error("Buyer discovery was cancelled."));
  }

  if (parent.aborted) {
    forwardAbort();
  } else {
    parent.addEventListener("abort", forwardAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parent.removeEventListener("abort", forwardAbort);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Buyer discovery was aborted.");
  }
}

function validateLimits(limits: BuyerDiscoveryLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (name === "maxCostUsd" || name === "retryBaseDelayMs" || name === "maxRetries") {
      continue;
    }

    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer.`);
    }
  }

  if (!Number.isInteger(limits.retryBaseDelayMs) || limits.retryBaseDelayMs < 0) {
    throw new RangeError("retryBaseDelayMs must be a non-negative integer.");
  }

  if (limits.maxRetries < 0 || limits.maxRetries > 2) {
    throw new RangeError("maxRetries must be between 0 and 2.");
  }

  if (limits.maxRawCandidates > 25) {
    throw new RangeError("maxRawCandidates cannot exceed 25.");
  }

  if (limits.verificationConcurrency > 3) {
    throw new RangeError("verificationConcurrency cannot exceed 3.");
  }

  if (limits.maxCostUsd !== undefined && (!Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0)) {
    throw new RangeError("maxCostUsd must be greater than zero when configured.");
  }
}
