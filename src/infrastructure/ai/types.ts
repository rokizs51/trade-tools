import type { z } from "zod";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
  serverToolCostUsd?: number;
}

export interface ModelCallMetadata {
  requestId: string;
  requestedModel: string;
  actualModel: string;
  provider?: string;
  latencyMs: number;
  generationTimeMs?: number;
  usage?: ModelUsage;
}

export interface ResearchSource {
  url: string;
  title: string;
  excerpt?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface StructuredModelRequest<T> {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  outputSchema: z.ZodType<T>;
  schemaDescription?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ResearchModelRequest<T> extends StructuredModelRequest<T> {
  formattingModel?: string;
  onSearchComplete?: (result: ResearchSearchResult) => void | Promise<void>;
  maxSearchCalls?: number;
  maxResultsPerSearch?: number;
  searchContextSize?: "low" | "medium" | "high";
  allowedDomains?: string[];
  excludedDomains?: string[];
}

export interface ModelCallResult<T> {
  data: T;
  metadata: ModelCallMetadata;
}

export interface ResearchCallResult<T> extends ModelCallResult<T> {
  researchText: string;
  sources: ResearchSource[];
  searchMetadata: ModelCallMetadata;
  formattingMetadata: ModelCallMetadata;
}

export interface ResearchSearchResult {
  researchText: string;
  sources: ResearchSource[];
  metadata: ModelCallMetadata;
}

export interface ModelClient {
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<ModelCallResult<T>>;
  research<T>(request: ResearchModelRequest<T>): Promise<ResearchCallResult<T>>;
}
