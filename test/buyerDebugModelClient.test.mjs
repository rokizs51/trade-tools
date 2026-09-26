import assert from "node:assert/strict";
import test from "node:test";

import { createDebugModelClient } from "../scripts/debugModelClient.mjs";

function metadata(id, model) {
  return { requestId: id, requestedModel: model, actualModel: model, latencyMs: 5, provider: "test", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } };
}

test("structured calls pass through unchanged and print the parsed output", async () => {
  const printed = [];
  const data = { normalizedCommodity: "coconut" };
  const client = {
    async generateStructured() {
      return { data, metadata: metadata("req-1", "model-a") };
    },
    async research() {
      throw new Error("not used");
    },
  };

  const wrapped = createDebugModelClient({ client, print: (label, payload) => printed.push({ label, payload }) });
  const result = await wrapped.generateStructured({ schemaName: "buyer_search_plan" });

  assert.equal(result.data, data);
  assert.equal(printed.length, 1);
  assert.equal(printed[0].label, "Structured output [buyer_search_plan]");
  assert.deepEqual(printed[0].payload.data, data);
  assert.equal(printed[0].payload.model, "model-a");
});

test("research prints the raw search text before formatting and chains the caller callback", async () => {
  const printed = [];
  const callerSearchResults = [];
  const search = { researchText: "RAW NOTES", sources: [{ url: "https://example.com", title: "Example" }], metadata: metadata("req-2", "research-model") };
  const researchResult = {
    data: { candidates: [{ companyName: "Acme" }] },
    metadata: metadata("req-2", "research-model"),
    researchText: search.researchText,
    sources: search.sources,
    searchMetadata: search.metadata,
    formattingMetadata: metadata("req-3", "formatter-model"),
  };
  const client = {
    async generateStructured() {
      throw new Error("not used");
    },
    async research(request) {
      await request.onSearchComplete(search);
      return researchResult;
    },
  };

  const wrapped = createDebugModelClient({ client, print: (label, payload) => printed.push({ label, payload }) });
  const result = await wrapped.research({
    schemaName: "buyer_candidate_batch",
    onSearchComplete: async (value) => callerSearchResults.push(value),
  });

  assert.equal(result, researchResult);
  assert.deepEqual(callerSearchResults, [search]);
  assert.equal(printed.length, 2);
  assert.equal(printed[0].label, "Research raw output [buyer_candidate_batch]");
  assert.equal(printed[0].payload.researchText, "RAW NOTES");
  assert.deepEqual(printed[0].payload.sources, [{ url: "https://example.com", title: "Example" }]);
  assert.equal(printed[1].label, "Research formatted output [buyer_candidate_batch]");
  assert.equal(printed[1].payload.candidateCount, 1);
});

test("research works when the caller provides no onSearchComplete callback", async () => {
  const printed = [];
  const search = { researchText: "NOTES", sources: [], metadata: metadata("req-4", "m") };
  const client = {
    async generateStructured() {
      throw new Error("not used");
    },
    async research(request) {
      await request.onSearchComplete(search);
      return {
        data: { candidates: [] },
        metadata: search.metadata,
        researchText: "NOTES",
        sources: [],
        searchMetadata: search.metadata,
        formattingMetadata: search.metadata,
      };
    },
  };

  const wrapped = createDebugModelClient({ client, print: (label) => printed.push(label) });
  const result = await wrapped.research({ schemaName: "buyer_candidate_batch" });

  assert.deepEqual(result.data.candidates, []);
  assert.deepEqual(printed, ["Research raw output [buyer_candidate_batch]", "Research formatted output [buyer_candidate_batch]"]);
});
