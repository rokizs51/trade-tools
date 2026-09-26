import { randomUUID } from "node:crypto";

import { BuyerSearchInputSchema } from "../dist/domain/buyers/index.js";
import {
  BUYER_FALLBACK_RESEARCH_PROMPT_VERSION,
  BUYER_PLANNER_PROMPT_VERSION,
  BUYER_RESEARCH_PROMPT_VERSION,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../dist/agents/buyerFinder/index.js";
import { createBuyerDiscoveryOrchestrator } from "../dist/application/buyerDiscovery/index.js";
import { OpenRouterModelClient } from "../dist/infrastructure/ai/index.js";
import { createBuyerSearchJobRunner } from "./buyerSearchJobRunner.mjs";
import { createDebugModelClient } from "./debugModelClient.mjs";

export class BuyerSearchQueueFullError extends Error {
  constructor(maxQueuedSearches) {
    super(`The local buyer-search queue already contains ${maxQueuedSearches} waiting searches.`);
    this.name = "BuyerSearchQueueFullError";
    this.code = "BUYER_SEARCH_QUEUE_FULL";
    this.maxQueuedSearches = maxQueuedSearches;
  }
}

export function createBuyerDiscoveryRuntime({
  repository,
  client,
  env = process.env,
  now = () => new Date().toISOString(),
  createId = randomUUID,
  logger,
}) {
  const config = readBuyerDiscoveryConfig(env);
  const baseClient = client ?? new OpenRouterModelClient({
    apiKey: env.OPENROUTER_API_KEY,
    timeoutMs: config.limits.timeoutMs,
    gpt5ReasoningEffort: config.gpt5ReasoningEffort,
  });
  const modelClient = booleanSetting(env.BUYER_DEBUG_RAW_OUTPUT, false, "BUYER_DEBUG_RAW_OUTPUT")
    ? createDebugModelClient({ client: baseClient })
    : baseClient;
  const orchestrator = createBuyerDiscoveryOrchestrator({
    client: modelClient,
    repository,
    models: config.models,
    limits: config.limits,
    gpt5ReasoningEffort: config.gpt5ReasoningEffort,
    createId,
    now,
    logger,
  });
  const runner = createBuyerSearchJobRunner({
    repository,
    now,
    execute(job) {
      return executeRun(job);

      async function executeRun(job) {
        const run = await repository.getSearchRun(job.runId);

        if (!run) {
          throw new Error(`Buyer search run ${job.runId} disappeared before execution.`);
        }

        return orchestrator.run(run.input, job);
      }
    },
  });

  return {
    config,

    async start(rawInput) {
      const input = BuyerSearchInputSchema.parse(rawInput);
      const queue = runner.getSnapshot();

      if (queue.queuedRunIds.length >= config.queue.maxQueuedSearches) {
        throw new BuyerSearchQueueFullError(config.queue.maxQueuedSearches);
      }

      const run = await repository.createSearchRun(input, {
        now: now(),
        createId,
        modelConfig: {
          requestedModels: config.models,
          gpt5ReasoningEffort: config.gpt5ReasoningEffort,
          promptVersions: config.promptVersions,
        },
      });
      await recordQueuedEvent(repository, run.id, now, logger);
      await runner.enqueue(run.id);
      return run;
    },

    cancel: runner.cancel,
    onIdle: runner.onIdle,
    getQueueSnapshot: runner.getSnapshot,
  };
}

export function readBuyerDiscoveryConfig(env = process.env) {
  const verifierModel = env.BUYER_VERIFIER_MODEL || "openai/gpt-4.1-mini";
  const maximumCost = optionalPositiveNumber(env.BUYER_SEARCH_MAX_COST_USD, "BUYER_SEARCH_MAX_COST_USD");

  return {
    models: {
      planner: env.BUYER_PLANNER_MODEL || "google/gemini-3.5-flash-lite",
      research: env.BUYER_RESEARCH_MODEL || "openai/gpt-4.1-mini",
      formatter: env.BUYER_FORMATTER_MODEL || verifierModel,
      verifier: verifierModel,
    },
    gpt5ReasoningEffort: reasoningEffort(
      env.BUYER_GPT5_REASONING_EFFORT,
      "BUYER_GPT5_REASONING_EFFORT",
    ),
    limits: {
      maxSearchCalls: positiveInteger(env.BUYER_SEARCH_MAX_QUERIES, 6, "BUYER_SEARCH_MAX_QUERIES"),
      maxResultsPerSearch: positiveInteger(env.BUYER_SEARCH_MAX_RESULTS, 5, "BUYER_SEARCH_MAX_RESULTS"),
      maxRawCandidates: positiveInteger(env.BUYER_SEARCH_MAX_RAW_CANDIDATES, 25, "BUYER_SEARCH_MAX_RAW_CANDIDATES"),
      verificationConcurrency: positiveInteger(env.BUYER_VERIFICATION_CONCURRENCY, 3, "BUYER_VERIFICATION_CONCURRENCY"),
      maxRetries: nonNegativeInteger(env.BUYER_SEARCH_MAX_RETRIES, 2, "BUYER_SEARCH_MAX_RETRIES"),
      retryBaseDelayMs: nonNegativeInteger(env.BUYER_SEARCH_RETRY_BASE_MS, 500, "BUYER_SEARCH_RETRY_BASE_MS"),
      timeoutMs: positiveInteger(env.BUYER_SEARCH_TIMEOUT_MS, 120_000, "BUYER_SEARCH_TIMEOUT_MS"),
      fallbackEnabled: booleanSetting(env.BUYER_FALLBACK_ENABLED, true, "BUYER_FALLBACK_ENABLED"),
      fallbackMinQualified: positiveInteger(
        env.BUYER_FALLBACK_MIN_QUALIFIED,
        3,
        "BUYER_FALLBACK_MIN_QUALIFIED",
      ),
      fallbackMaxSearchCalls: positiveInteger(
        env.BUYER_FALLBACK_MAX_SEARCH_CALLS,
        2,
        "BUYER_FALLBACK_MAX_SEARCH_CALLS",
      ),
      fallbackMaxCandidates: positiveInteger(
        env.BUYER_FALLBACK_MAX_CANDIDATES,
        10,
        "BUYER_FALLBACK_MAX_CANDIDATES",
      ),
      ...(maximumCost === undefined ? {} : { maxCostUsd: maximumCost }),
    },
    queue: {
      maxQueuedSearches: positiveInteger(
        env.BUYER_SEARCH_MAX_QUEUED,
        10,
        "BUYER_SEARCH_MAX_QUEUED",
      ),
    },
    promptVersions: {
      planner: BUYER_PLANNER_PROMPT_VERSION,
      research: BUYER_RESEARCH_PROMPT_VERSION,
      fallbackResearch: BUYER_FALLBACK_RESEARCH_PROMPT_VERSION,
      verifier: BUYER_VERIFIER_PROMPT_VERSION,
    },
  };
}

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function nonNegativeInteger(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function optionalPositiveNumber(value, name) {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }

  return parsed;
}

function reasoningEffort(value, name) {
  if (value === undefined || value === "") return "low";
  const normalized = String(value).trim().toLowerCase();
  if (["low", "medium", "high"].includes(normalized)) return normalized;
  throw new Error(`${name} must be low, medium, or high.`);
}

async function recordQueuedEvent(repository, runId, now, logger) {
  const event = {
    eventType: "SEARCH_QUEUED",
    message: "Search request was accepted and added to the local queue.",
  };
  logger?.event({ runId, ...event });
  if (typeof repository.recordSearchEvent === "function") {
    try {
      await repository.recordSearchEvent(runId, event, { now: now() });
    } catch (error) {
      logger?.event({
        runId,
        level: "ERROR",
        eventType: "EVENT_LOG_WRITE_FAILED",
        message: "Could not persist the queued Buyer Finder event.",
        details: { errorCode: error?.code ?? "EVENT_LOG_WRITE_FAILED" },
      });
    }
  }
}

function booleanSetting(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}
