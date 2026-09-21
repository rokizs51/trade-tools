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
  instructions?: string;
  promptVersion?: string;
  schemaDescription?: string;
}

export function createBuyerResearcher(options: BuyerResearcherOptions) {
  return {
    research(
      input: BuyerSearchInput,
      plan: BuyerSearchPlan,
      runOptions: {
        signal: AbortSignal;
        retrievedAt: string;
        existingSearchResult?: ResearchSearchResult;
        onSearchComplete?: (result: ResearchSearchResult) => void | Promise<void>;
      },
    ): Promise<ResearchCallResult<BuyerCandidateBatch>> {
      const instructions = options.instructions ?? BUYER_RESEARCH_INSTRUCTIONS;
      const promptVersion = options.promptVersion ?? BUYER_RESEARCH_PROMPT_VERSION;
      return options.client.research({
        model: options.model,
        formattingModel: options.formattingModel,
        instructions: `${instructions}\nUse ${runOptions.retrievedAt} as the retrieval timestamp.`,
        input: JSON.stringify({
          criteria: input,
          approvedPlan: plan,
          promptVersion,
        }),
        schemaName: "buyer_candidate_batch",
        schemaDescription: options.schemaDescription ?? "Publicly sourced potential buyer companies.",
        outputSchema: BuyerCandidateBatchSchema,
        maxOutputTokens: 8_000,
        maxSearchCalls: options.maxSearchCalls,
        maxResultsPerSearch: options.maxResultsPerSearch,
        searchContextSize: options.searchContextSize ?? "medium",
        signal: runOptions.signal,
        ...(runOptions.existingSearchResult
          ? { existingSearchResult: runOptions.existingSearchResult }
          : {}),
        ...(runOptions.onSearchComplete ? { onSearchComplete: runOptions.onSearchComplete } : {}),
      });
    },
  };
}
