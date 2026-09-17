import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  OpenRouterModelCapabilityError,
  OpenRouterModelClient,
  OpenRouterResearchStageError,
} from "../dist/infrastructure/ai/index.js";

const ResultSchema = z.object({ answer: z.string() }).strict();

function response(outputText, overrides = {}) {
  return {
    id: "response-123",
    model: "provider/actual-model",
    outputText,
    output: [],
    usage: {
      inputTokens: 40,
      outputTokens: 12,
      totalTokens: 52,
      cost: 0.0012,
      costDetails: { serverToolCost: 0.004 },
    },
    openrouterMetadata: {
      generationTime: 750,
      attempts: [{ model: "provider/actual-model", provider: "Provider A", status: 200 }],
      endpoints: {
        available: [{ model: "provider/actual-model", provider: "Provider A", selected: true }],
      },
      attempt: 1,
      isByok: false,
      region: null,
      requested: "provider/requested-model",
      strategy: "fallback",
      summary: "selected",
    },
    ...overrides,
  };
}

test("structured calls enforce schema and private provider routing", async () => {
  let captured;
  let capturedOptions;
  const controller = new AbortController();
  const client = new OpenRouterModelClient({
    transport: {
      async send(request, options) {
        captured = request;
        capturedOptions = options;
        return response('{"answer":"validated"}');
      },
    },
  });

  const result = await client.generateStructured({
    model: "provider/requested-model",
    instructions: "Return the answer.",
    input: "question",
    schemaName: "answer",
    outputSchema: ResultSchema,
    signal: controller.signal,
  });

  assert.deepEqual(result.data, { answer: "validated" });
  assert.equal(captured.xOpenRouterMetadata, "enabled");
  assert.equal(captured.responsesRequest.model, "provider/requested-model");
  assert.equal(captured.responsesRequest.store, false);
  assert.deepEqual(captured.responsesRequest.provider, {
    allowFallbacks: false,
    dataCollection: "deny",
    requireParameters: true,
    zdr: true,
  });
  assert.equal(captured.responsesRequest.text.format.type, "json_schema");
  assert.equal(captured.responsesRequest.text.format.strict, true);
  assert.equal(captured.responsesRequest.text.format.schema.additionalProperties, false);
  assert.equal(result.metadata.actualModel, "provider/actual-model");
  assert.equal(result.metadata.provider, "Provider A");
  assert.equal(result.metadata.usage.costUsd, 0.0012);
  assert.equal(result.metadata.usage.serverToolCostUsd, 0.004);
  assert.equal(result.metadata.generationTimeMs, 750);
  assert.equal(capturedOptions.signal, controller.signal);
});

test("generation schema removes unsupported constraints while local Zod validation remains strict", async () => {
  let captured;
  const ConstrainedSchema = z.object({
    code: z.string().min(2).max(5).regex(/^[A-Z]+$/),
    confirmed: z.literal(true),
  }).strict();
  const client = new OpenRouterModelClient({
    transport: {
      async send(request) {
        captured = request;
        return response('{"code":"AB","confirmed":true}');
      },
    },
  });

  await client.generateStructured({
    model: "provider/model",
    instructions: "Return constrained output.",
    input: "input",
    schemaName: "constrained",
    outputSchema: ConstrainedSchema,
  });

  const generationSchema = captured.responsesRequest.text.format.schema;
  assert.equal("$schema" in generationSchema, false);
  assert.equal("minLength" in generationSchema.properties.code, false);
  assert.equal("maxLength" in generationSchema.properties.code, false);
  assert.equal("pattern" in generationSchema.properties.code, false);
  assert.equal("const" in generationSchema.properties.confirmed, false);

  const invalidClient = new OpenRouterModelClient({
    transport: { async send() { return response('{"code":"lowercase","confirmed":false}'); } },
  });
  await assert.rejects(
    invalidClient.generateStructured({
      model: "provider/model",
      instructions: "Return constrained output.",
      input: "input",
      schemaName: "constrained",
      outputSchema: ConstrainedSchema,
    }),
    z.ZodError,
  );
});

test("optional fields use strict nullable generation fields and normalize before local validation", async () => {
  let captured;
  const OptionalSchema = z.object({
    requiredValue: z.string(),
    optionalValue: z.string().optional(),
    optionalUrl: z.url().optional(),
  }).strict();
  const client = new OpenRouterModelClient({
    transport: {
      async send(request) {
        captured = request;
        return response('{"requiredValue":"present","optionalValue":null,"optionalUrl":null}');
      },
    },
  });

  const result = await client.generateStructured({
    model: "provider/model",
    instructions: "Return output.",
    input: "input",
    schemaName: "optional",
    outputSchema: OptionalSchema,
  });

  assert.deepEqual(captured.responsesRequest.text.format.schema.required, [
    "requiredValue",
    "optionalValue",
    "optionalUrl",
  ]);
  assert.deepEqual(
    captured.responsesRequest.text.format.schema.properties.optionalValue.anyOf[1],
    { type: "null" },
  );
  assert.equal(
    "format" in captured.responsesRequest.text.format.schema.properties.optionalUrl.anyOf[0],
    false,
  );
  assert.deepEqual(result.data, { requiredValue: "present" });
});

test("structured calls reject JSON that violates the local Zod schema", async () => {
  const client = new OpenRouterModelClient({
    transport: { async send() { return response('{"unexpected":true}'); } },
  });

  await assert.rejects(
    client.generateStructured({
      model: "provider/model",
      instructions: "Return the answer.",
      input: "question",
      schemaName: "answer",
      outputSchema: ResultSchema,
    }),
    z.ZodError,
  );
});

test("research calls configure bounded web search and recover unique source URLs", async () => {
  const captured = [];
  const capturedOptions = [];
  let callCount = 0;
  let observedSearch;
  const controller = new AbortController();
  const client = new OpenRouterModelClient({
    transport: {
      async send(request, options) {
        captured.push(request);
        capturedOptions.push(options);
        callCount += 1;
        if (callCount === 2) {
          return response('{"answer":"researched"}', {
            id: "formatting-response",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              cost: 0.0003,
              costDetails: {},
            },
          });
        }

        return response("Research evidence about Example Company.", {
          output: [
            {
              type: "openrouter:web_search",
              status: "completed",
              action: {
                type: "search",
                query: "coconut importer dubai",
                sources: [
                  { type: "url", url: "https://example.com/company" },
                  { type: "url", url: "https://example.com/directory" },
                ],
              },
            },
            {
              type: "message",
              id: "message-1",
              role: "assistant",
              content: [{
                type: "output_text",
                text: "Research evidence about Example Company.",
                annotations: [{
                  type: "url_citation",
                  url: "https://example.com/company",
                  title: "Example Company",
                  content: "Imports coconut products.",
                  startIndex: 0,
                  endIndex: 10,
                }],
              }],
            },
          ],
        });
      },
    },
  });

  const result = await client.research({
    model: "provider/model",
    formattingModel: "provider/formatting-model",
    instructions: "Research.",
    input: "criteria",
    schemaName: "research",
    outputSchema: ResultSchema,
    maxSearchCalls: 2,
    maxResultsPerSearch: 4,
    searchContextSize: "low",
    excludedDomains: ["blocked.example"],
    onSearchComplete(search) {
      observedSearch = search;
    },
    signal: controller.signal,
  });

  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0].responsesRequest.tools, [{
    type: "openrouter:web_search",
    parameters: {
      engine: "exa",
      maxUses: 2,
      maxResults: 4,
      searchContextSize: "low",
      excludedDomains: ["blocked.example"],
    },
  }]);
  assert.equal(captured[0].responsesRequest.maxToolCalls, 2);
  assert.equal(captured[0].responsesRequest.text, undefined);
  assert.equal(captured[1].responsesRequest.tools, undefined);
  assert.equal(captured[1].responsesRequest.model, "provider/formatting-model");
  assert.equal(captured[1].responsesRequest.text.format.type, "json_schema");
  assert.match(captured[1].responsesRequest.input, /Research evidence about Example Company/);
  assert.match(captured[1].responsesRequest.input, /https:\/\/example.com\/company/);
  assert.deepEqual(result.sources, [
    {
      url: "https://example.com/company",
      title: "Example Company",
      excerpt: "Imports coconut products.",
      startIndex: 0,
      endIndex: 10,
    },
    {
      url: "https://example.com/directory",
      title: "https://example.com/directory",
    },
  ]);
  assert.equal(result.searchMetadata.requestId, "response-123");
  assert.equal(result.formattingMetadata.requestId, "formatting-response");
  assert.equal(result.researchText, "Research evidence about Example Company.");
  assert.equal(observedSearch.researchText, result.researchText);
  assert.deepEqual(observedSearch.sources, result.sources);
  assert.equal(observedSearch.metadata.requestId, "response-123");
  assert.equal(result.formattingMetadata.requestedModel, "provider/formatting-model");
  assert.equal(result.metadata.usage.totalTokens, 67);
  assert.equal(result.metadata.usage.costUsd, 0.0015);
  assert.equal(result.metadata.usage.serverToolCostUsd, 0.004);
  assert.equal(capturedOptions[0].signal, controller.signal);
  assert.equal(capturedOptions[1].signal, controller.signal);
});

test("the production client refuses to initialize without a server-side API key", () => {
  assert.throws(
    () => new OpenRouterModelClient({}),
    /OPENROUTER_API_KEY is required/,
  );
});

test("parameter-routing failures identify the incompatible model without leaking the SDK stack", async () => {
  const routingError = Object.assign(new Error("No endpoints found that can handle the requested parameters."), {
    statusCode: 404,
    error: { metadata: { failed_routing_step: "Filter by Parameters" } },
  });
  const client = new OpenRouterModelClient({
    transport: { async send() { throw routingError; } },
  });

  await assert.rejects(
    client.generateStructured({
      model: "unsupported/free-model",
      instructions: "Return the answer.",
      input: "question",
      schemaName: "answer",
      outputSchema: ResultSchema,
    }),
    (error) => {
      assert.ok(error instanceof OpenRouterModelCapabilityError);
      assert.equal(error.model, "unsupported/free-model");
      assert.match(error.message, /strict JSON Schema and privacy routing/);
      assert.equal(error.cause, routingError);
      return true;
    },
  );
});

test("research errors identify whether the search stage failed", async () => {
  const client = new OpenRouterModelClient({
    transport: { async send() { throw new Error("upstream failure"); } },
  });

  await assert.rejects(
    client.research({
      model: "provider/model",
      instructions: "Research.",
      input: "criteria",
      schemaName: "research",
      outputSchema: ResultSchema,
    }),
    (error) => {
      assert.ok(error instanceof OpenRouterResearchStageError);
      assert.equal(error.stage, "search");
      assert.match(error.message, /search stage failed/);
      return true;
    },
  );
});
