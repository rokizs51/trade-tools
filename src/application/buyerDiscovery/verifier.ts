import { CandidateVerificationSchema } from "../../domain/buyers/schemas.js";
import type {
  BuyerSearchInput,
  CandidateVerification,
  ResearchCandidate,
} from "../../domain/buyers/types.js";
import {
  BUYER_VERIFIER_INSTRUCTIONS,
  BUYER_VERIFIER_PROMPT_VERSION,
} from "../../agents/buyerFinder/prompts.js";
import type { ModelCallResult, ModelClient } from "../../infrastructure/ai/types.js";

export function createBuyerCandidateVerifier(options: { client: ModelClient; model: string }) {
  return {
    verify(
      criteria: BuyerSearchInput,
      candidate: ResearchCandidate,
      signal: AbortSignal,
    ): Promise<ModelCallResult<CandidateVerification>> {
      return options.client.generateStructured({
        model: options.model,
        instructions: BUYER_VERIFIER_INSTRUCTIONS,
        input: JSON.stringify({
          criteria,
          candidate,
          promptVersion: BUYER_VERIFIER_PROMPT_VERSION,
        }),
        schemaName: "buyer_candidate_verification",
        schemaDescription: "Evidence-based verification of one potential buyer company.",
        outputSchema: CandidateVerificationSchema,
        maxOutputTokens: 2_000,
        signal,
      });
    },
  };
}
