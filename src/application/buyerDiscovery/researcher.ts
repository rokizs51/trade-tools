import type { BuyerSearchInput, BuyerSearchPlan } from "../../domain/buyers/types.js";
import {
  BUYER_RESEARCH_INSTRUCTIONS,
  BUYER_RESEARCH_PROMPT_VERSION,
} from "../../agents/buyerFinder/prompts.js";
import type {
  ModelClient,
  ResearchCallResult,
  ResearchSearchResult,
} from "../../infrastructure/ai/types.js";
import { BuyerCandidateBatchSchema, type BuyerCandidateBatch } from "./schemas.js";

export interface BuyerResearcherOptions {
  client: ModelClient;
  model: string;
  formattingModel: string;
  maxSearchCalls: number;
  maxResultsPerSearch: number;
  searchContextSize?: "low" | "medium" | "high";
}

export function createBuyerResearcher(options: BuyerResearcherOptions) {
  return {
    research(
      input: BuyerSearchInput,
      plan: BuyerSearchPlan,
      runOptions: {
        signal: AbortSignal;
        retrievedAt: string;
        onSearchComplete?: (result: ResearchSearchResult) => void | Promise<void>;
      },
    ): Promise<ResearchCallResult<BuyerCandidateBatch>> {
      return options.client.research({
        model: options.model,
        formattingModel: options.formattingModel,
        instructions: `${BUYER_RESEARCH_INSTRUCTIONS}\nUse ${runOptions.retrievedAt} as the retrieval timestamp.`,
        input: JSON.stringify({
          criteria: input,
          approvedPlan: plan,
          promptVersion: BUYER_RESEARCH_PROMPT_VERSION,
        }),
        schemaName: "buyer_candidate_batch",
        schemaDescription: "Publicly sourced potential buyer companies.",
        outputSchema: BuyerCandidateBatchSchema,
        maxOutputTokens: 8_000,
        maxSearchCalls: options.maxSearchCalls,
        maxResultsPerSearch: options.maxResultsPerSearch,
        searchContextSize: options.searchContextSize ?? "medium",
        signal: runOptions.signal,
        ...(runOptions.onSearchComplete ? { onSearchComplete: runOptions.onSearchComplete } : {}),
      });
    },
  };
}
