import { z } from "zod";

import { ResearchCandidateSchema } from "../../domain/buyers/schemas.js";
import type { ResearchCandidate } from "../../domain/buyers/types.js";

export interface BuyerCandidateBatch {
  candidates: ResearchCandidate[];
}

export const BuyerCandidateBatchSchema = z
  .object({
    candidates: z.array(ResearchCandidateSchema).max(25),
  })
  .strict() as unknown as z.ZodType<BuyerCandidateBatch>;
