import { z } from "zod";

import {
  BuyerSearchInputSchema,
  BuyerSearchPlanSchema,
  ResearchCandidateSchema,
} from "../dist/domain/buyers/index.js";
import {
  BUYER_PLANNER_INSTRUCTIONS,
  BUYER_PLANNER_PROMPT_VERSION,
  BUYER_RESEARCH_INSTRUCTIONS,
  BUYER_RESEARCH_PROMPT_VERSION,
} from "../dist/agents/buyerFinder/index.js";
import { OpenRouterModelClient } from "../dist/infrastructure/ai/index.js";
import { MAX_RESEARCH_TARGET_CANDIDATES } from "../dist/application/buyerDiscovery/index.js";

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("OPENROUTER_API_KEY is required. Add it to the local .env file or server shell, then rerun npm run buyer:spike.");
  process.exitCode = 1;
} else {
  try {
    await runSpike(apiKey);
  } catch (error) {
    console.error(formatSpikeError(error));
    process.exitCode = 1;
  }
}

async function runSpike(key) {
  const input = BuyerSearchInputSchema.parse({
    commodity: process.env.BUYER_SPIKE_COMMODITY ?? "Semi-husked coconut",
    targetCountry: process.env.BUYER_SPIKE_COUNTRY ?? "Thailand",
    targetArea: process.env.BUYER_SPIKE_AREA ?? "Thailand",
    buyerTypes: ["IMPORTER", "DISTRIBUTOR"],
    resultLimit: 3,
    requireWebsite: true,
    requireContact: false,
  });

  const plannerModel = process.env.BUYER_PLANNER_MODEL ?? "google/gemini-3.5-flash-lite";
  const researchModel = process.env.BUYER_RESEARCH_MODEL ?? "openai/gpt-4.1-mini";
  const formattingModel = process.env.BUYER_VERIFIER_MODEL ?? plannerModel;
  const client = new OpenRouterModelClient({
    apiKey: key,
    timeoutMs: Number(process.env.BUYER_SEARCH_TIMEOUT_MS ?? 120_000),
  });

  console.error(`Running planner with ${plannerModel}...`);
  const planResult = await client.generateStructured({
    model: plannerModel,
    instructions: BUYER_PLANNER_INSTRUCTIONS,
    input: JSON.stringify(input),
    schemaName: "buyer_search_plan",
    schemaDescription: `Search plan using prompt ${BUYER_PLANNER_PROMPT_VERSION}.`,
    outputSchema: BuyerSearchPlanSchema,
    maxOutputTokens: 2_000,
  });

  printStageResult("Planner Agent", {
    plan: planResult.data,
    metadata: planResult.metadata,
  });

  const CandidateBatchSchema = z
    .object({
      candidates: z.array(ResearchCandidateSchema).min(1).max(input.resultLimit),
    })
    .strict();

  console.error(`Planner complete in ${planResult.metadata.latencyMs} ms. Running research with ${researchModel}, then formatting with ${formattingModel}...`);
  const researchResult = await client.research({
    model: researchModel,
    formattingModel,
    instructions: `${BUYER_RESEARCH_INSTRUCTIONS}\nUse ${new Date().toISOString()} as the retrieval timestamp.`,
    input: JSON.stringify({
      criteria: input,
      approvedPlan: planResult.data,
      promptVersion: BUYER_RESEARCH_PROMPT_VERSION,
      coverageContract: {
        minQualifiedCandidates: Math.min(input.resultLimit, MAX_RESEARCH_TARGET_CANDIDATES),
        maxSearches: Number(process.env.BUYER_SEARCH_MAX_QUERIES ?? 6),
      },
    }),
    schemaName: "buyer_candidate_batch",
    schemaDescription: "Publicly sourced potential buyer companies.",
    outputSchema: CandidateBatchSchema,
    maxOutputTokens: 5_000,
    maxSearchCalls: Number(process.env.BUYER_SEARCH_MAX_QUERIES ?? 6),
    maxResultsPerSearch: Number(process.env.BUYER_SEARCH_MAX_RESULTS ?? 5),
    searchContextSize: "medium",
    onSearchComplete(search) {
      printStageResult("Research Agent", {
        researchText: search.researchText,
        sources: search.sources,
        metadata: search.metadata,
      });
      console.error(`Research evidence collected from ${search.sources.length} source(s). Starting formatter...`);
    },
  });

  if (researchResult.sources.length === 0) {
    throw new Error("The research response validated, but no source URL was recovered from OpenRouter.");
  }

  console.error(`Research complete in ${researchResult.metadata.latencyMs} ms with ${researchResult.sources.length} source(s).`);

  printStageResult("Formatting Agent", {
    candidates: researchResult.data.candidates,
    metadata: researchResult.formattingMetadata,
  });

  console.log(JSON.stringify({
    criteria: input,
    plan: planResult.data,
    candidates: researchResult.data.candidates,
    sources: researchResult.sources,
    calls: {
      planner: planResult.metadata,
      researchSearch: researchResult.searchMetadata,
      researchFormatting: researchResult.formattingMetadata,
      researchTotal: researchResult.metadata,
    },
  }, null, 2));
}

function printStageResult(stage, result) {
  console.error(`\n=== ${stage} Result ===`);
  console.error(JSON.stringify(result, null, 2));
  console.error(`=== End ${stage} Result ===\n`);
}

function formatSpikeError(error) {
  if (!(error instanceof Error)) return String(error);

  const lines = [];
  let candidate = error;
  let depth = 0;

  while (candidate instanceof Error && depth < 4) {
    lines.push(`${depth === 0 ? "" : "Caused by: "}${candidate.name}: ${candidate.message}`);
    if (typeof candidate.statusCode === "number") {
      lines.push(`HTTP status: ${candidate.statusCode}`);
    }

    const providerError = candidate.error;
    if (providerError && typeof providerError === "object") {
      if (typeof providerError.code === "number" || typeof providerError.code === "string") {
        lines.push(`OpenRouter code: ${providerError.code}`);
      }
      if (typeof providerError.message === "string" && providerError.message !== candidate.message) {
        lines.push(`OpenRouter detail: ${providerError.message}`);
      }

      const metadata = providerError.metadata;
      if (metadata && typeof metadata === "object") {
        for (const key of ["provider_name", "failed_routing_step", "raw"]) {
          const value = metadata[key];
          if (typeof value === "string" && value.length > 0) {
            lines.push(`${key}: ${value.slice(0, 2_000)}`);
          }
        }
      }
    }

    candidate = candidate.cause;
    depth += 1;
  }

  lines.push("The API key and request content are intentionally omitted from this diagnostic.");
  return lines.join("\n");
}
