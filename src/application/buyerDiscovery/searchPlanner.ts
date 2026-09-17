import { z } from "zod";

import { BuyerSearchPlanSchema } from "../../domain/buyers/schemas.js";
import type { BuyerSearchInput, BuyerSearchPlan } from "../../domain/buyers/types.js";
import {
  BUYER_PLANNER_INSTRUCTIONS,
  BUYER_PLANNER_PROMPT_VERSION,
} from "../../agents/buyerFinder/prompts.js";
import type { ModelCallResult, ModelClient } from "../../infrastructure/ai/types.js";

export function createBuyerSearchPlanner(options: { client: ModelClient; model: string }) {
  return {
    plan(input: BuyerSearchInput, signal: AbortSignal) {
      return options.client.generateStructured<BuyerSearchPlan>({
        model: options.model,
        instructions: BUYER_PLANNER_INSTRUCTIONS,
        input: JSON.stringify(input),
        schemaName: "buyer_search_plan",
        schemaDescription: `Search plan using prompt ${BUYER_PLANNER_PROMPT_VERSION}.`,
        outputSchema: BuyerSearchPlanSchema as z.ZodType<BuyerSearchPlan>,
        maxOutputTokens: 2_000,
        signal,
      });
    },
  } satisfies {
    plan(
      input: BuyerSearchInput,
      signal: AbortSignal,
    ): Promise<ModelCallResult<BuyerSearchPlan>>;
  };
}
