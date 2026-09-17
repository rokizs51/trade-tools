import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBuyerDiscoveryRuntime, readBuyerDiscoveryConfig } from "../scripts/buyerDiscoveryRuntime.mjs";
import { createSqliteBuyerRepository } from "../scripts/sqliteBuyerRepository.mjs";

function metadata(id, model) {
  return {
    requestId: id,
    requestedModel: model,
    actualModel: model,
    latencyMs: 1,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.0001 },
  };
}

test("buyer runtime composes the queue, orchestrator, repository, and injected model client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-buyer-runtime-"));
  const repository = createSqliteBuyerRepository(join(dir, "trade-tools.sqlite"));
  const client = {
    async generateStructured(request) {
      return {
        data: {
          normalizedCommodity: "coconut",
          commodityAliases: [],
          localLanguageTerms: [],
          targetCountry: "United Arab Emirates",
          buyerTypes: ["IMPORTER"],
          searchQueries: ["coconut importer UAE"],
          exclusions: [],
          evidenceRequirements: ["Buyer evidence"],
        },
        metadata: metadata("planner", request.model),
      };
    },
    async research(request) {
      const searchMetadata = metadata("search", request.model);
      const formattingMetadata = metadata("formatting", request.formattingModel);
      await request.onSearchComplete?.({ researchText: "No qualified companies found.", sources: [], metadata: searchMetadata });
      return {
        data: { candidates: [] },
        researchText: "No qualified companies found.",
        sources: [],
        searchMetadata,
        formattingMetadata,
        metadata: metadata("research-total", request.formattingModel),
      };
    },
  };
  let id = 0;

  try {
    const runtime = createBuyerDiscoveryRuntime({
      repository,
      client,
      env: {
        BUYER_PLANNER_MODEL: "fake/planner",
        BUYER_RESEARCH_MODEL: "fake/research",
        BUYER_FORMATTER_MODEL: "fake/formatter",
        BUYER_VERIFIER_MODEL: "fake/verifier",
        BUYER_SEARCH_MAX_RETRIES: "0",
      },
      now: () => "2026-09-17T08:00:00.000Z",
      createId: () => `runtime-${++id}`,
    });
    const created = runtime.start({
      commodity: "Coconut",
      targetCountry: "United Arab Emirates",
      buyerTypes: ["IMPORTER"],
      resultLimit: 10,
    });

    await runtime.onIdle();
    const completed = repository.getSearchRun(created.id);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.modelConfig.requestedModels.formatter, "fake/formatter");
    assert.equal(completed.progress.total, 0);
  } finally {
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buyer runtime validates numeric environment settings", () => {
  assert.throws(
    () => readBuyerDiscoveryConfig({ BUYER_VERIFICATION_CONCURRENCY: "many" }),
    /BUYER_VERIFICATION_CONCURRENCY must be a positive integer/,
  );
  assert.throws(
    () => readBuyerDiscoveryConfig({ BUYER_SEARCH_MAX_COST_USD: "0" }),
    /BUYER_SEARCH_MAX_COST_USD must be a positive number/,
  );
});
