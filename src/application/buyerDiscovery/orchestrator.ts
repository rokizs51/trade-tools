import {
  BuyerSearchInputSchema,
} from "../../domain/buyers/schemas.js";
import {
  deduplicateBuyerCandidates,
} from "../../domain/buyers/deduplicate.js";
import {
  extractCanonicalDomain,
  normalizeCompanyName,
  normalizeCountryCode,
  normalizeSearchText,
  normalizeSourceUrl,
} from "../../domain/buyers/normalize.js";
import { calculateBuyerConfidence } from "../../domain/buyers/scoring.js";
import type {
  BuyerSearchInput,
  BuyerSearchPlan,
  CandidateVerification,
  ResearchCandidate,
  SearchRunStatus,
} from "../../domain/buyers/types.js";
import {
  BUYER_PLANNER_PROMPT_VERSION,
  BUYER_FALLBACK_RESEARCH_INSTRUCTIONS,
  BUYER_FALLBACK_RESEARCH_PROMPT_VERSION,
  BUYER_RESEARCH_PROMPT_VERSION,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../../agents/buyerFinder/prompts.js";
import type {
  ModelCallMetadata,
  ModelClient,
  ResearchSearchResult,
} from "../../infrastructure/ai/types.js";
import { BuyerDiscoveryBudgetExceededError, BuyerDiscoveryTimeoutError } from "./errors.js";
import { createBuyerResearcher } from "./researcher.js";
import { withBuyerDiscoveryRetry } from "./retry.js";
import { createBuyerSearchPlanner } from "./searchPlanner.js";
import { createBuyerCandidateVerifier } from "./verifier.js";
import {
  buyerCandidateConflictsWithCountry,
  buyerCandidateIdentityKey,
  buyerCandidateMatchesExclusion,
  buildBuyerFallbackPlan,
  getMissingBuyerEvidenceTypes,
  hasMaterialBuyerEvidenceImprovement,
  MANDATORY_BUYER_EVIDENCE_TYPES,
  selectBuyerRepairCandidates,
  type EvaluatedFallbackCandidate,
} from "./fallback.js";

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
  fallbackEnabled: boolean;
  fallbackMinQualified: number;
  fallbackMaxSearchCalls: number;
  fallbackMaxCandidates: number;
}

interface BuyerSearchJobContext {
  runId: string;
  signal: AbortSignal;
  transition(status: SearchRunStatus, changes?: Record<string, unknown>): unknown | Promise<unknown>;
  updateProgress(progress: { current: number; total: number; stage?: string }): unknown | Promise<unknown>;
  updateTelemetry(telemetry: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: string;
    modelConfig: Record<string, unknown>;
  }): unknown | Promise<unknown>;
  recordEvent?(event: {
    level?: "INFO" | "WARN" | "ERROR";
    eventType: string;
    message: string;
    details?: Record<string, unknown>;
  }): unknown | Promise<unknown>;
}

interface BuyerPersistenceRepository {
  saveCandidateBundle(
    searchRunId: string,
    bundle: Record<string, unknown>,
    options: { now: string; createId: () => string },
  ): unknown | Promise<unknown>;
}

export interface BuyerDiscoveryOrchestratorOptions {
  client: ModelClient;
  repository: BuyerPersistenceRepository;
  models: BuyerDiscoveryModels;
  limits: BuyerDiscoveryLimits;
  gpt5ReasoningEffort?: "low" | "medium" | "high";
  createId: () => string;
  now?: () => string;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface BuyerDiscoverySummary {
  researchedCandidateCount: number;
  groundedCandidateCount: number;
  groundingRejectedCount: number;
  deduplicatedCandidateCount: number;
  verificationCandidateCount: number;
  verifiedCandidateCount: number;
  savedCandidateCount: number;
  rejectedCandidateCount: number;
  savedMatchCount: number;
}

export interface BuyerDiscoveryFallbackSummary {
  triggered: boolean;
  reason: "INSUFFICIENT_QUALIFIED_RESULTS" | "NO_REPAIRABLE_CANDIDATES";
  minimumQualified: number;
  passCount: 0 | 1;
  repairCandidateCount: number;
  supplementalResearchedCandidateCount: number;
  supplementalGroundedCandidateCount: number;
  reverifiedCandidateCount: number;
  recoveredQualifiedCount: number;
  recoveredMatchCount: number;
  warning?: string;
}

interface CallRecord {
  stage:
    | "PLANNER"
    | "RESEARCH_SEARCH"
    | "RESEARCH_FORMATTING"
    | "VERIFIER"
    | "FALLBACK_RESEARCH_SEARCH"
    | "FALLBACK_RESEARCH_FORMATTING"
    | "FALLBACK_VERIFIER";
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
  const fallbackResearcher = createBuyerResearcher({
    client: options.client,
    model: options.models.research,
    formattingModel: options.models.formatter,
    maxSearchCalls: options.limits.fallbackMaxSearchCalls,
    maxResultsPerSearch: options.limits.maxResultsPerSearch,
    instructions: BUYER_FALLBACK_RESEARCH_INSTRUCTIONS,
    promptVersion: BUYER_FALLBACK_RESEARCH_PROMPT_VERSION,
    schemaDescription: "Grounded evidence-repair results for named potential buyer companies.",
  });
  const verifier = createBuyerCandidateVerifier({ client: options.client, model: options.models.verifier });
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async run(rawInput: BuyerSearchInput, job: BuyerSearchJobContext): Promise<BuyerDiscoverySummary> {
      const input = BuyerSearchInputSchema.parse(rawInput);
      const runSignal = createRunSignal(job.signal, options.limits.timeoutMs);
      const telemetry = createTelemetryTracker(
        options.models,
        options.limits.maxCostUsd,
        options.gpt5ReasoningEffort,
      );

      function record(stage: CallRecord["stage"], metadata: ModelCallMetadata): boolean {
        const changed = telemetry.record(stage, metadata);
        telemetry.assertBudget();
        return changed;
      }

        async function recordAndPersist(stage: CallRecord["stage"], metadata: ModelCallMetadata): Promise<void> {
          const changed = telemetry.record(stage, metadata);
          if (changed) await job.updateTelemetry(telemetry.snapshot());
          if (changed) {
            await job.recordEvent?.({
              eventType: "MODEL_CALL_COMPLETED",
              message: `${formatTelemetryStage(stage)} completed.`,
              details: {
                stage,
                model: metadata.actualModel,
                latencyMs: metadata.latencyMs,
                inputTokens: metadata.usage?.inputTokens ?? 0,
                outputTokens: metadata.usage?.outputTokens ?? 0,
                costUsd: metadata.usage?.costUsd ?? metadata.usage?.serverToolCostUsd ?? 0,
              },
            });
          }
          telemetry.assertBudget();
        }

      try {
        await job.updateProgress({ current: 0, total: 1, stage: "Preparing search" });
        const planResult = await planner.plan(input, runSignal.signal);
        const plan = enforcePlanInvariants(input, planResult.data);
        await recordAndPersist("PLANNER", planResult.metadata);
        await job.updateProgress({ current: 1, total: 1, stage: "Preparing search" });
        await job.transition("RESEARCHING", {
          plan,
          modelConfig: telemetry.snapshot().modelConfig,
        });

        await job.updateProgress({ current: 0, total: 1, stage: "Searching sources" });
        const retrievedAt = now();
        let completedSearch: ResearchSearchResult | undefined;
        const researchResult = await withBuyerDiscoveryRetry(
          () => researcher.research(input, plan, {
            signal: runSignal.signal,
            retrievedAt,
            ...(completedSearch ? { existingSearchResult: completedSearch } : {}),
            onSearchComplete(searchResult) {
              completedSearch = searchResult;
              record("RESEARCH_SEARCH", searchResult.metadata);
            },
          }),
          retryOptions(options, runSignal.signal),
        );
        await recordAndPersist("RESEARCH_SEARCH", researchResult.searchMetadata);
        await recordAndPersist("RESEARCH_FORMATTING", researchResult.formattingMetadata);
        await job.updateProgress({ current: 1, total: 1, stage: "Searching sources" });

        const grounding = retainGroundedCandidates(
          researchResult.data.candidates.slice(0, options.limits.maxRawCandidates),
          researchResult.sources.map((source) => source.url),
          retrievedAt,
        );
        const deduplicated = deduplicateBuyerCandidates(grounding.candidates);
        const candidates = rankCandidatesForVerification(deduplicated.candidates).slice(0, input.resultLimit);
        await job.transition("VERIFYING", {
          progressCurrent: 0,
          progressTotal: candidates.length,
          modelConfig: telemetry.snapshot().modelConfig,
        });

        let verifiedCandidateCount = 0;
        let verificationCandidateCount = candidates.length;
        let savedCandidateCount = 0;
        let savedMatchCount = 0;
        let researchedCandidateCount = researchResult.data.candidates.length;
        let groundedCandidateCount = grounding.candidates.length;
        let groundingRejectedCount = grounding.decisions.length;
        let deduplicatedCandidateCount = deduplicated.candidates.length;
        let fallbackSummary: BuyerDiscoveryFallbackSummary | undefined;
        const decisions: BuyerCandidateDecision[] = grounding.decisions.map((decision) => ({
          ...decision,
          researchPass: "STRICT",
        }));
        const evaluated: EvaluatedCandidateRecord[] = [];
        const savedCandidateKeys = new Set<string>();
        const savedMatchKeys = new Set<string>();

        async function evaluateCandidate(
          candidate: ResearchCandidate,
          researchPass: "STRICT" | "FALLBACK",
        ): Promise<EvaluatedCandidateRecord> {
          const verificationResult = await withBuyerDiscoveryRetry(
            () => verifier.verify(input, candidate, runSignal.signal),
            retryOptions(options, runSignal.signal),
          );
          await recordAndPersist(
            researchPass === "STRICT" ? "VERIFIER" : "FALLBACK_VERIFIER",
            verificationResult.metadata,
          );

          const verification = enforceDeterministicRequirements(
            input,
            candidate,
            verificationResult.data,
          );
          const confidence = calculateBuyerConfidence(verification);
          verifiedCandidateCount += 1;
          const decision: BuyerCandidateDecision = {
            companyName: candidate.companyName,
            status: verification.status,
            isEligible: confidence.isEligible,
            confidenceScore: confidence.score,
            confidenceLevel: confidence.level,
            missingEvidenceTypes: getMissingBuyerEvidenceTypes(candidate),
            rejectionReasons: confidence.rejectionReasons,
            researchPass,
          };

          return { candidate, verification, isEligible: confidence.isEligible, decision };
        }

        async function persistEvaluatedCandidate(record: EvaluatedCandidateRecord): Promise<number> {
          if (!record.isEligible) return 0;

          const candidateKey = buyerCandidateIdentityKey(record.candidate);
          const buyerTypes = record.candidate.buyerTypes.filter((type) => input.buyerTypes.includes(type));
          let addedMatches = 0;

          for (const buyerType of buyerTypes) {
            const matchKey = `${candidateKey}:${buyerType}`;
            if (savedMatchKeys.has(matchKey)) continue;

            await options.repository.saveCandidateBundle(job.runId, {
              company: {
                name: record.candidate.companyName,
                websiteUrl: record.candidate.websiteUrl,
                countryCode: record.candidate.countryCode,
                countryName: record.candidate.country,
                city: record.candidate.city,
                address: record.candidate.address,
              },
              match: {
                commodity: input.commodity,
                buyerType,
                commodityRelationship: record.candidate.commodityRelationship,
                confidenceScore: record.decision.confidenceScore,
                confidenceLevel: record.decision.confidenceLevel,
                verificationStatus: record.verification.status,
                reviewStatus: "NEW",
                rejectionReason: record.decision.rejectionReasons.join(" ") || undefined,
              },
              sources: record.candidate.evidence,
              contacts: record.candidate.contacts,
            }, {
              now: now(),
              createId: options.createId,
            });
            savedMatchKeys.add(matchKey);
            addedMatches += 1;
          }

          if (addedMatches > 0 && !savedCandidateKeys.has(candidateKey)) {
            savedCandidateKeys.add(candidateKey);
            savedCandidateCount += 1;
          }
          savedMatchCount += addedMatches;
          return addedMatches;
        }

        await mapWithConcurrency(
          candidates,
          options.limits.verificationConcurrency,
          runSignal.signal,
          async (candidate) => {
            const record = await evaluateCandidate(candidate, "STRICT");
            evaluated.push(record);
            upsertBuyerDecision(decisions, record.decision, candidate);
            await persistEvaluatedCandidate(record);

            await job.updateProgress({
              current: evaluated.length,
              total: candidates.length,
              stage: "Verifying candidates",
            });
          },
        );

        const minimumQualified = Math.min(options.limits.fallbackMinQualified, input.resultLimit);
        if (options.limits.fallbackEnabled && savedCandidateCount < minimumQualified) {
          const repairCandidates = selectBuyerRepairCandidates(
            input,
            evaluated,
            options.limits.fallbackMaxCandidates,
          );
          const fallbackPlan = buildBuyerFallbackPlan(
            input,
            plan,
            repairCandidates,
            options.limits.fallbackMaxSearchCalls,
          );

          if (!fallbackPlan) {
            fallbackSummary = createEmptyFallbackSummary(minimumQualified, repairCandidates.length);
            await job.recordEvent?.({
              eventType: "FALLBACK_SKIPPED",
              message: "Additional evidence research was not run because there were no safe repair candidates.",
              details: { repairCandidateCount: repairCandidates.length },
            });
          } else {
            fallbackSummary = {
              triggered: true,
              reason: "INSUFFICIENT_QUALIFIED_RESULTS",
              minimumQualified,
              passCount: 1,
              repairCandidateCount: repairCandidates.length,
              supplementalResearchedCandidateCount: 0,
              supplementalGroundedCandidateCount: 0,
              reverifiedCandidateCount: 0,
              recoveredQualifiedCount: 0,
              recoveredMatchCount: 0,
            };
            await job.recordEvent?.({
              eventType: "FALLBACK_STARTED",
              message: "Additional evidence research started because the strict pass returned too few qualified candidates.",
              details: { minimumQualified, repairCandidateCount: repairCandidates.length },
            });

            try {
              await job.updateProgress({ current: 0, total: 1, stage: "Finding additional evidence" });
              const fallbackRetrievedAt = now();
              let completedFallbackSearch: ResearchSearchResult | undefined;
              const fallbackResult = await withBuyerDiscoveryRetry(
                () => fallbackResearcher.research(input, fallbackPlan, {
                  signal: runSignal.signal,
                  retrievedAt: fallbackRetrievedAt,
                  ...(completedFallbackSearch ? { existingSearchResult: completedFallbackSearch } : {}),
                  onSearchComplete(searchResult) {
                    completedFallbackSearch = searchResult;
                    record("FALLBACK_RESEARCH_SEARCH", searchResult.metadata);
                  },
                }),
                retryOptions(options, runSignal.signal),
              );
              await recordAndPersist("FALLBACK_RESEARCH_SEARCH", fallbackResult.searchMetadata);
              await recordAndPersist("FALLBACK_RESEARCH_FORMATTING", fallbackResult.formattingMetadata);
              await job.updateProgress({ current: 1, total: 1, stage: "Finding additional evidence" });

              const fallbackGrounding = retainGroundedCandidates(
                fallbackResult.data.candidates.slice(0, options.limits.maxRawCandidates),
                fallbackResult.sources.map((source) => source.url),
                fallbackRetrievedAt,
              );
              fallbackSummary.supplementalResearchedCandidateCount = fallbackResult.data.candidates.length;
              fallbackSummary.supplementalGroundedCandidateCount = fallbackGrounding.candidates.length;
              researchedCandidateCount += fallbackResult.data.candidates.length;
              groundedCandidateCount += fallbackGrounding.candidates.length;
              groundingRejectedCount += fallbackGrounding.decisions.length;

              for (const decision of fallbackGrounding.decisions) {
                upsertBuyerDecision(decisions, { ...decision, researchPass: "FALLBACK" });
              }

              const combined = deduplicateBuyerCandidates([
                ...deduplicated.candidates,
                ...fallbackGrounding.candidates,
              ]);
              deduplicatedCandidateCount = combined.candidates.length;
              const remainingResultSlots = Math.max(0, input.resultLimit - savedCandidateCount);
              const fallbackCandidates = rankCandidatesForVerification(combined.candidates)
                .filter((candidate) => {
                  const previous = findMatchingBuyerCandidate(deduplicated.candidates, candidate);
                  const previousRecord = previous
                    ? evaluated.find((record) => candidatesRepresentSameCompany(record.candidate, previous))
                    : undefined;
                  return !previousRecord?.isEligible
                    && hasMaterialBuyerEvidenceImprovement(previous, candidate, input);
                })
                .slice(0, Math.min(options.limits.fallbackMaxCandidates, remainingResultSlots));

              verificationCandidateCount += fallbackCandidates.length;
              await job.updateProgress({
                current: 0,
                total: fallbackCandidates.length,
                stage: "Verifying improved candidates",
              });

              let fallbackVerified = 0;
              await mapWithConcurrency(
                fallbackCandidates,
                options.limits.verificationConcurrency,
                runSignal.signal,
                async (candidate) => {
                  const record = await evaluateCandidate(candidate, "FALLBACK");
                  evaluated.push(record);
                  upsertBuyerDecision(decisions, record.decision, candidate);
                  const beforeCandidateCount = savedCandidateCount;
                  const addedMatches = await persistEvaluatedCandidate(record);
                  if (savedCandidateCount > beforeCandidateCount) {
                    fallbackSummary!.recoveredQualifiedCount += 1;
                  }
                  fallbackSummary!.recoveredMatchCount += addedMatches;
                  fallbackVerified += 1;
                  fallbackSummary!.reverifiedCandidateCount = fallbackVerified;
                  await job.updateProgress({
                    current: fallbackVerified,
                    total: fallbackCandidates.length,
                    stage: "Verifying improved candidates",
                  });
                },
              );
            } catch (error) {
              if (isFallbackHardStop(error, runSignal.signal) || savedCandidateCount === 0) throw error;
              fallbackSummary.warning = "Additional evidence research failed; strict qualified results were retained.";
              await job.recordEvent?.({
                level: "WARN",
                eventType: "FALLBACK_FAILED",
                message: "Additional evidence research failed; strict qualified results were retained.",
              });
            }
          }
        }

        const rejectedCandidateCount = decisions.filter((decision) => !decision.isEligible).length;
        const summary = {
          researchedCandidateCount,
          groundedCandidateCount,
          groundingRejectedCount,
          deduplicatedCandidateCount,
          verificationCandidateCount,
          verifiedCandidateCount,
          savedCandidateCount,
          rejectedCandidateCount,
          savedMatchCount,
        };

        await job.transition("SAVING", {
          progressCurrent: verifiedCandidateCount,
          progressTotal: verifiedCandidateCount,
          currentStage: "Saving qualified results",
          modelConfig: telemetry.snapshot().modelConfig,
          outcome: {
            summary,
            ...(fallbackSummary ? { fallback: fallbackSummary } : {}),
            decisions: decisions.sort((first, second) => first.companyName.localeCompare(second.companyName)),
          },
        });

        return summary;
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

function createTelemetryTracker(
  models: BuyerDiscoveryModels,
  maximumCostUsd: number | undefined,
  gpt5ReasoningEffort?: "low" | "medium" | "high",
) {
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
          ...(gpt5ReasoningEffort ? { gpt5ReasoningEffort } : {}),
          promptVersions: {
            planner: BUYER_PLANNER_PROMPT_VERSION,
            research: BUYER_RESEARCH_PROMPT_VERSION,
            fallbackResearch: BUYER_FALLBACK_RESEARCH_PROMPT_VERSION,
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

  if (buyerCandidateConflictsWithCountry(input, candidate)) {
    targetCountryVerified = false;
    status = "REJECTED";
    reasons.push("Candidate country conflicts with the requested target country.");
  }

  if (buyerCandidateMatchesExclusion(input, candidate)) {
    status = "REJECTED";
    reasons.push("Candidate matches a user-provided exclusion.");
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

interface BuyerCandidateDecision {
  companyName: string;
  status: "VERIFIED" | "NEEDS_REVIEW" | "REJECTED";
  isEligible: boolean;
  confidenceScore: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  missingEvidenceTypes: string[];
  rejectionReasons: string[];
  researchPass?: "STRICT" | "FALLBACK";
}

function formatTelemetryStage(stage: CallRecord["stage"]): string {
  return stage.toLocaleLowerCase("en").replaceAll("_", " ");
}

interface EvaluatedCandidateRecord extends EvaluatedFallbackCandidate {
  decision: BuyerCandidateDecision;
}

function retainGroundedCandidates(
  candidates: ResearchCandidate[],
  recoveredSourceUrls: string[],
  retrievedAt: string,
): { candidates: ResearchCandidate[]; decisions: BuyerCandidateDecision[] } {
  const recovered = new Set(
    recoveredSourceUrls
      .map((url) => normalizeSourceUrl(url))
      .filter((url): url is string => Boolean(url)),
  );

  const retained: ResearchCandidate[] = [];
  const decisions: BuyerCandidateDecision[] = [];

  for (const candidate of candidates) {
    const evidence = candidate.evidence.filter((source) => {
      const normalized = normalizeSourceUrl(source.url);
      return normalized !== undefined && recovered.has(normalized);
    }).map((source) => ({ ...source, retrievedAt }));
    const evidenceUrls = new Set(evidence.map((source) => normalizeSourceUrl(source.url)));

    if (evidence.length === 0) {
      decisions.push({
        companyName: candidate.companyName,
        status: "REJECTED",
        isEligible: false,
        confidenceScore: 0,
        confidenceLevel: "LOW",
        missingEvidenceTypes: [...MANDATORY_BUYER_EVIDENCE_TYPES],
        rejectionReasons: ["No candidate evidence URL was recovered from the web-research response."],
      });
      continue;
    }

    retained.push({
      ...candidate,
      evidence,
      contacts: candidate.contacts.filter((contact) => evidenceUrls.has(normalizeSourceUrl(contact.sourceUrl))),
    });
  }

  return { candidates: retained, decisions };
}

function rankCandidatesForVerification(candidates: ResearchCandidate[]): ResearchCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: candidateEvidenceCompleteness(candidate) }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map(({ candidate }) => candidate);
}

function candidateEvidenceCompleteness(candidate: ResearchCandidate): number {
  const evidenceTypes = new Set(candidate.evidence.map((source) => source.evidenceType));
  const mandatoryCount = MANDATORY_BUYER_EVIDENCE_TYPES.filter((type) => evidenceTypes.has(type)).length;
  const sourceCount = new Set(candidate.evidence.map((source) => normalizeSourceUrl(source.url))).size;
  return mandatoryCount * 100 + Math.min(sourceCount, 9) * 10 + (candidate.websiteUrl ? 5 : 0) + (candidate.contacts.length > 0 ? 1 : 0);
}

function enforcePlanInvariants(input: BuyerSearchInput, proposed: BuyerSearchPlan): BuyerSearchPlan {
  const { targetArea: _proposedTargetArea, ...rest } = proposed;
  return {
    ...rest,
    targetCountry: input.targetCountry,
    ...(input.targetArea ? { targetArea: input.targetArea } : {}),
    buyerTypes: [...input.buyerTypes],
    exclusions: [...new Set([...(proposed.exclusions ?? []), ...(input.exclusions ?? [])])],
  };
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
  const positiveIntegerLimits = {
    maxSearchCalls: limits.maxSearchCalls,
    maxResultsPerSearch: limits.maxResultsPerSearch,
    maxRawCandidates: limits.maxRawCandidates,
    verificationConcurrency: limits.verificationConcurrency,
    timeoutMs: limits.timeoutMs,
    fallbackMinQualified: limits.fallbackMinQualified,
    fallbackMaxSearchCalls: limits.fallbackMaxSearchCalls,
    fallbackMaxCandidates: limits.fallbackMaxCandidates,
  };

  for (const [name, value] of Object.entries(positiveIntegerLimits)) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
  }

  if (typeof limits.fallbackEnabled !== "boolean") {
    throw new TypeError("fallbackEnabled must be a boolean.");
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

  if (limits.fallbackMaxSearchCalls > 10) {
    throw new RangeError("fallbackMaxSearchCalls cannot exceed 10.");
  }

  if (limits.fallbackMaxCandidates > 25) {
    throw new RangeError("fallbackMaxCandidates cannot exceed 25.");
  }

  if (limits.maxCostUsd !== undefined && (!Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0)) {
    throw new RangeError("maxCostUsd must be greater than zero when configured.");
  }
}

function createEmptyFallbackSummary(
  minimumQualified: number,
  repairCandidateCount: number,
): BuyerDiscoveryFallbackSummary {
  return {
    triggered: false,
    reason: "NO_REPAIRABLE_CANDIDATES",
    minimumQualified,
    passCount: 0,
    repairCandidateCount,
    supplementalResearchedCandidateCount: 0,
    supplementalGroundedCandidateCount: 0,
    reverifiedCandidateCount: 0,
    recoveredQualifiedCount: 0,
    recoveredMatchCount: 0,
  };
}

function upsertBuyerDecision(
  decisions: BuyerCandidateDecision[],
  decision: BuyerCandidateDecision,
  candidate?: ResearchCandidate,
): void {
  const index = decisions.findIndex((existing) => {
    if (candidate) return normalizeSearchText(existing.companyName) === normalizeSearchText(candidate.companyName);
    return normalizeSearchText(existing.companyName) === normalizeSearchText(decision.companyName);
  });

  if (index >= 0) decisions[index] = decision;
  else decisions.push(decision);
}

function findMatchingBuyerCandidate(
  candidates: readonly ResearchCandidate[],
  target: ResearchCandidate,
): ResearchCandidate | undefined {
  return candidates.find((candidate) => candidatesRepresentSameCompany(candidate, target));
}

function candidatesRepresentSameCompany(first: ResearchCandidate, second: ResearchCandidate): boolean {
  const firstDomain = extractCanonicalDomain(first.websiteUrl);
  const secondDomain = extractCanonicalDomain(second.websiteUrl);
  if (firstDomain && secondDomain && firstDomain === secondDomain) return true;

  const firstCountry = normalizeCountryCode(first.countryCode ?? first.country) ?? normalizeSearchText(first.country);
  const secondCountry = normalizeCountryCode(second.countryCode ?? second.country) ?? normalizeSearchText(second.country);
  return normalizeCompanyName(first.companyName) === normalizeCompanyName(second.companyName)
    && firstCountry === secondCountry;
}

function isFallbackHardStop(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted
    || error instanceof BuyerDiscoveryBudgetExceededError
    || error instanceof BuyerDiscoveryTimeoutError;
}
