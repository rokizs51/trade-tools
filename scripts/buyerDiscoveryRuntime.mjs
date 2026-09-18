import { randomUUID } from "node:crypto";

import { BuyerSearchInputSchema } from "../dist/domain/buyers/index.js";
import {
  BUYER_PLANNER_PROMPT_VERSION,
  BUYER_RESEARCH_PROMPT_VERSION,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../dist/agents/buyerFinder/index.js";
import { createBuyerDiscoveryOrchestrator } from "../dist/application/buyerDiscovery/index.js";
import { OpenRouterModelClient } from "../dist/infrastructure/ai/index.js";
import { createBuyerSearchJobRunner } from "./buyerSearchJobRunner.mjs";

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
}) {
  const config = readBuyerDiscoveryConfig(env);
  const modelClient = client ?? new OpenRouterModelClient({
    apiKey: env.OPENROUTER_API_KEY,
    timeoutMs: config.limits.timeoutMs,
  });
  const orchestrator = createBuyerDiscoveryOrchestrator({
    client: modelClient,
    repository,
    models: config.models,
    limits: config.limits,
    createId,
    now,
  });
  const runner = createBuyerSearchJobRunner({
    repository,
    now,
    execute(job) {
      const run = repository.getSearchRun(job.runId);

      if (!run) {
        throw new Error(`Buyer search run ${job.runId} disappeared before execution.`);
      }

      return orchestrator.run(run.input, job);
    },
  });

  return {
    config,

    start(rawInput) {
      const input = BuyerSearchInputSchema.parse(rawInput);
      const queue = runner.getSnapshot();

      if (queue.queuedRunIds.length >= config.queue.maxQueuedSearches) {
        throw new BuyerSearchQueueFullError(config.queue.maxQueuedSearches);
      }

      const run = repository.createSearchRun(input, {
        now: now(),
        createId,
        modelConfig: {
          requestedModels: config.models,
          promptVersions: config.promptVersions,
        },
      });
      runner.enqueue(run.id);
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
    limits: {
      maxSearchCalls: positiveInteger(env.BUYER_SEARCH_MAX_QUERIES, 3, "BUYER_SEARCH_MAX_QUERIES"),
      maxResultsPerSearch: positiveInteger(env.BUYER_SEARCH_MAX_RESULTS, 5, "BUYER_SEARCH_MAX_RESULTS"),
      maxRawCandidates: positiveInteger(env.BUYER_SEARCH_MAX_RAW_CANDIDATES, 25, "BUYER_SEARCH_MAX_RAW_CANDIDATES"),
      verificationConcurrency: positiveInteger(env.BUYER_VERIFICATION_CONCURRENCY, 3, "BUYER_VERIFICATION_CONCURRENCY"),
      maxRetries: nonNegativeInteger(env.BUYER_SEARCH_MAX_RETRIES, 2, "BUYER_SEARCH_MAX_RETRIES"),
      retryBaseDelayMs: nonNegativeInteger(env.BUYER_SEARCH_RETRY_BASE_MS, 500, "BUYER_SEARCH_RETRY_BASE_MS"),
      timeoutMs: positiveInteger(env.BUYER_SEARCH_TIMEOUT_MS, 120_000, "BUYER_SEARCH_TIMEOUT_MS"),
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
