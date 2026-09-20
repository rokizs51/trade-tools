import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBuyerSearchJobRunner } from "../scripts/buyerSearchJobRunner.mjs";
import { createSqliteBuyerRepository } from "../scripts/sqliteBuyerRepository.mjs";
import { createBuyerDiscoveryOrchestrator } from "../dist/application/buyerDiscovery/index.js";

const input = {
  commodity: "Semi-husked coconut",
  targetCountry: "United Arab Emirates",
  buyerTypes: ["IMPORTER"],
  resultLimit: 10,
  requireWebsite: true,
};

const plan = {
  normalizedCommodity: "semi-husked coconut",
  commodityAliases: ["semi husked coconut"],
  localLanguageTerms: [],
  targetCountry: "United Arab Emirates",
  buyerTypes: ["IMPORTER"],
  searchQueries: ["semi-husked coconut importer UAE"],
  exclusions: [],
  evidenceRequirements: ["Direct commodity and importer evidence"],
};

const verified = {
  status: "VERIFIED",
  companyIdentityVerified: true,
  targetCountryVerified: true,
  commodityRelationshipVerified: true,
  requestedBuyerRoleVerified: true,
  officialWebsiteVerified: true,
  publicContactVerified: false,
  multipleConsistentSources: true,
  rejectionReasons: [],
  notes: [],
};

function candidate(name, country = "United Arab Emirates", code = "AE") {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const sourceUrl = `https://${slug}.example`;

  return {
    companyName: name,
    country,
    countryCode: code,
    city: "Dubai",
    websiteUrl: `https://${slug}.example`,
    buyerTypes: ["IMPORTER"],
    commodityRelationship: "Imports and distributes semi-husked coconut.",
    contacts: [],
    evidence: [
      {
        url: `${sourceUrl}/about`,
        title: `${name} about`,
        publisher: name,
        retrievedAt: "2026-09-17T08:00:00.000Z",
        evidenceType: "COMPANY_IDENTITY",
        excerpt: `${name} company profile.`,
      },
      {
        url: `${sourceUrl}/locations`,
        title: `${name} locations`,
        publisher: name,
        retrievedAt: "2026-09-17T08:00:00.000Z",
        evidenceType: "LOCATION",
        excerpt: `Operates in ${country}.`,
      },
      {
        url: `${sourceUrl}/products`,
        title: `${name} products`,
        publisher: name,
        retrievedAt: "2026-09-17T08:00:00.000Z",
        evidenceType: "COMMODITY",
        excerpt: "Imports semi-husked coconut.",
      },
      {
        url: `${sourceUrl}/imports`,
        title: `${name} import activity`,
        publisher: name,
        retrievedAt: "2026-09-17T08:00:00.000Z",
        evidenceType: "BUYER_ROLE",
        excerpt: "Acts as an importer.",
      },
    ],
  };
}

function metadata(id, model, costUsd = 0.001) {
  return {
    requestId: id,
    requestedModel: model,
    actualModel: model,
    provider: "Fake Provider",
    latencyMs: 10,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd,
    },
  };
}

function createFakeClient({ candidates = [candidate("Good Imports")], onResearch, onVerify, plannerPlan = plan } = {}) {
  let verifierCalls = 0;

  return {
    get verifierCalls() { return verifierCalls; },

    async generateStructured(request) {
      if (request.schemaName === "buyer_search_plan") {
        return { data: plannerPlan, metadata: metadata("planner-1", request.model) };
      }

      verifierCalls += 1;
      const payload = JSON.parse(request.input);
      if (onVerify) {
        return onVerify(request, payload.candidate, verifierCalls);
      }

      return {
        data: verified,
        metadata: metadata(`verifier-${verifierCalls}`, request.model),
      };
    },

    async research(request) {
      if (onResearch) {
        return onResearch(request);
      }

      const searchMetadata = metadata("research-search-1", request.model, 0.002);
      const formattingMetadata = metadata("research-format-1", request.formattingModel, 0.001);
      await request.onSearchComplete?.({
        researchText: "Grounded fake research.",
        sources: candidates.flatMap((item) => item.evidence.map(({ url, title, excerpt }) => ({ url, title, excerpt }))),
        metadata: searchMetadata,
      });

      return {
        data: { candidates },
        researchText: "Grounded fake research.",
        sources: candidates.flatMap((item) => item.evidence.map(({ url, title, excerpt }) => ({ url, title, excerpt }))),
        searchMetadata,
        formattingMetadata,
        metadata: metadata("research-total-1", request.formattingModel, 0.003),
      };
    },
  };
}

function createIds(prefix = "entity") {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function defaultLimits(overrides = {}) {
  return {
    maxSearchCalls: 3,
    maxResultsPerSearch: 5,
    maxRawCandidates: 25,
    verificationConcurrency: 3,
    maxRetries: 2,
    retryBaseDelayMs: 0,
    timeoutMs: 5_000,
    maxCostUsd: 1,
    ...overrides,
  };
}

async function withHarness({ client, limits = defaultLimits(), afterEnqueue, searchInput = input }, run) {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-buyer-orchestrator-"));
  const repository = createSqliteBuyerRepository(join(dir, "trade-tools.sqlite"));
  repository.createSearchRun(searchInput, {
    now: "2026-09-17T07:00:00.000Z",
    createId: () => "run-1",
  });

  let summary;
  const orchestrator = createBuyerDiscoveryOrchestrator({
    client,
    repository,
    models: {
      planner: "fake/planner",
      research: "fake/research",
      formatter: "fake/formatter",
      verifier: "fake/verifier",
    },
    limits,
    createId: createIds(),
    now: () => "2026-09-17T08:00:00.000Z",
    sleep: async () => {},
    random: () => 0,
  });
  const runner = createBuyerSearchJobRunner({
    repository,
    recoverStaleRuns: false,
    now: () => "2026-09-17T08:00:00.000Z",
    execute: async (job) => {
      summary = await orchestrator.run(searchInput, job);
    },
  });

  try {
    await runner.enqueue("run-1");
    await afterEnqueue?.({ repository, runner });
    await runner.onIdle();
    await run({ repository, summary, runner });
  } finally {
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("orchestrator runs planner, research, verification, scoring, and persistence end to end", async () => {
  const client = createFakeClient({
    candidates: [
      candidate("Good Imports"),
      candidate("Wrong Country Imports", "United States", "US"),
    ],
  });

  await withHarness({ client }, async ({ repository, summary }) => {
    const run = repository.getSearchRun("run-1");
    const results = repository.getSearchResults("run-1");

    assert.equal(run.status, "COMPLETED");
    assert.deepEqual(run.plan.searchQueries, plan.searchQueries);
    assert.equal(run.progress.current, 2);
    assert.equal(run.progress.total, 2);
    assert.equal(run.usage.inputTokens, 50);
    assert.equal(run.usage.outputTokens, 25);
    assert.equal(run.usage.estimatedCostUsd, "0.00600000");
    assert.equal(run.modelConfig.promptVersions.verifier, "buyer-verifier-v3");
    assert.equal(run.modelConfig.calls.length, 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].company.name, "Good Imports");
    assert.equal(results[0].confidence.score, 90);
    assert.deepEqual(summary, {
      researchedCandidateCount: 2,
      groundedCandidateCount: 2,
      groundingRejectedCount: 0,
      deduplicatedCandidateCount: 2,
      verificationCandidateCount: 2,
      verifiedCandidateCount: 2,
      savedCandidateCount: 1,
      rejectedCandidateCount: 1,
      savedMatchCount: 1,
    });
    assert.deepEqual(run.outcome.summary, summary);
    assert.equal(run.outcome.decisions.length, 2);
    assert.equal(run.outcome.decisions.find((decision) => decision.companyName === "Wrong Country Imports").isEligible, false);
  });
});

test("orchestrator retries transient research failures", async () => {
  let attempts = 0;
  const baseClient = createFakeClient();
  const client = createFakeClient({
    async onResearch(request) {
      attempts += 1;

      if (attempts === 1) {
        throw Object.assign(new Error("Temporary upstream failure"), { statusCode: 503 });
      }

      return baseClient.research(request);
    },
  });

  await withHarness({ client }, async ({ repository }) => {
    assert.equal(attempts, 2);
    assert.equal(repository.getSearchRun("run-1").status, "COMPLETED");
  });
});

test("orchestrator reuses completed web research when formatting is retried", async () => {
  const researched = candidate("Cached Research Imports");
  const sources = researched.evidence.map(({ url, title, excerpt }) => ({ url, title, excerpt }));
  const searchMetadata = metadata("cached-search", "fake/research", 0.002);
  let calls = 0;
  const client = createFakeClient({
    async onResearch(request) {
      calls += 1;

      if (calls === 1) {
        assert.equal(request.existingSearchResult, undefined);
        await request.onSearchComplete?.({
          researchText: "Reusable grounded research.",
          sources,
          metadata: searchMetadata,
        });
        const upstream = Object.assign(new Error("temporary formatting failure"), { statusCode: 500 });
        throw new Error("OpenRouter research formatting stage failed.", { cause: upstream });
      }

      assert.deepEqual(request.existingSearchResult, {
        researchText: "Reusable grounded research.",
        sources,
        metadata: searchMetadata,
      });
      const formattingMetadata = metadata("cached-format", request.formattingModel, 0.001);
      return {
        data: { candidates: [researched] },
        researchText: request.existingSearchResult.researchText,
        sources: request.existingSearchResult.sources,
        searchMetadata: request.existingSearchResult.metadata,
        formattingMetadata,
        metadata: metadata("cached-total", request.formattingModel, 0.003),
      };
    },
  });

  await withHarness({ client }, async ({ repository }) => {
    assert.equal(calls, 2);
    assert.equal(repository.getSearchResults("run-1").length, 1);
    const run = repository.getSearchRun("run-1");
    assert.equal(run.modelConfig.calls.filter((call) => call.stage === "RESEARCH_SEARCH").length, 1);
  });
});

test("orchestrator restores user-controlled planner fields when the model drifts", async () => {
  const client = createFakeClient({
    plannerPlan: {
      ...plan,
      targetCountry: "United States",
      targetArea: "Texas",
      buyerTypes: ["RETAILER"],
    },
  });

  await withHarness({ client }, async ({ repository }) => {
    const savedPlan = repository.getSearchRun("run-1").plan;
    assert.equal(savedPlan.targetCountry, input.targetCountry);
    assert.equal("targetArea" in savedPlan, false);
    assert.deepEqual(savedPlan.buyerTypes, input.buyerTypes);
  });
});

test("orchestrator ranks evidence-complete candidates before applying the result limit", async () => {
  const incomplete = candidate("First Weak Candidate");
  incomplete.evidence = incomplete.evidence.filter((source) => source.evidenceType === "COMMODITY");
  const complete = candidate("Second Strong Candidate");
  const client = createFakeClient({ candidates: [incomplete, complete] });

  await withHarness({
    client,
    searchInput: { ...input, resultLimit: 1 },
  }, async ({ repository, summary }) => {
    const results = repository.getSearchResults("run-1");
    assert.equal(results.length, 1);
    assert.equal(results[0].company.name, "Second Strong Candidate");
    assert.equal(summary.verificationCandidateCount, 1);
  });
});

test("orchestrator rejects candidate evidence URLs not recovered by research", async () => {
  const unsupportedCandidate = candidate("Invented Source Imports");
  const client = createFakeClient({
    candidates: [unsupportedCandidate],
    async onResearch(request) {
      const searchMetadata = metadata("grounding-search", request.model);
      const formattingMetadata = metadata("grounding-format", request.formattingModel);
      const sources = [{ url: "https://observed.example/source", title: "Observed source" }];
      await request.onSearchComplete?.({ researchText: "Observed research.", sources, metadata: searchMetadata });
      return {
        data: { candidates: [unsupportedCandidate] },
        researchText: "Observed research.",
        sources,
        searchMetadata,
        formattingMetadata,
        metadata: metadata("grounding-total", request.formattingModel),
      };
    },
  });

  await withHarness({ client }, async ({ repository, summary }) => {
    assert.equal(repository.getSearchRun("run-1").status, "COMPLETED");
    assert.equal(repository.getSearchResults("run-1").length, 0);
    assert.equal(client.verifierCalls, 0);
    assert.equal(summary.researchedCandidateCount, 1);
    assert.equal(summary.deduplicatedCandidateCount, 0);
  });
});

test("orchestrator drops an unsupported evidence item without discarding an otherwise grounded candidate", async () => {
  const grounded = candidate("Partially Grounded Imports");
  grounded.evidence.push({
    url: "https://invented.example/contact",
    title: "Unsupported contact",
    retrievedAt: "2026-09-17T08:00:00.000Z",
    evidenceType: "CONTACT",
    excerpt: "Unsupported contact claim.",
  });
  const client = createFakeClient({
    candidates: [grounded],
    async onResearch(request) {
      const searchMetadata = metadata("partial-search", request.model);
      const formattingMetadata = metadata("partial-format", request.formattingModel);
      const sources = grounded.evidence
        .filter((source) => !source.url.includes("invented.example"))
        .map(({ url, title, excerpt }) => ({ url, title, excerpt }));
      await request.onSearchComplete?.({ researchText: "Grounded research.", sources, metadata: searchMetadata });
      return {
        data: { candidates: [grounded] },
        researchText: "Grounded research.",
        sources,
        searchMetadata,
        formattingMetadata,
        metadata: metadata("partial-total", request.formattingModel),
      };
    },
  });

  await withHarness({ client }, async ({ repository, summary }) => {
    const results = repository.getSearchResults("run-1");
    assert.equal(results.length, 1);
    assert.equal(results[0].sources.some((source) => source.url.includes("invented.example")), false);
    assert.equal(summary.groundingRejectedCount, 0);
  });
});

test("orchestrator requires field-level evidence before scoring a candidate as eligible", async () => {
  const incomplete = candidate("Incomplete Evidence Imports");
  incomplete.evidence = incomplete.evidence.filter((source) => source.evidenceType === "COMMODITY");
  const client = createFakeClient({ candidates: [incomplete] });

  await withHarness({ client }, async ({ repository, summary }) => {
    assert.equal(repository.getSearchRun("run-1").status, "COMPLETED");
    assert.equal(repository.getSearchResults("run-1").length, 0);
    assert.equal(summary.verifiedCandidateCount, 1);
    assert.equal(summary.rejectedCandidateCount, 1);
  });
});

test("orchestrator stops when the configured cost budget is exceeded", async () => {
  const client = createFakeClient();

  await withHarness({ client, limits: defaultLimits({ maxCostUsd: 0.0005 }) }, async ({ repository }) => {
    const run = repository.getSearchRun("run-1");
    assert.equal(run.status, "FAILED");
    assert.equal(run.error.code, "BUYER_DISCOVERY_BUDGET_EXCEEDED");
    assert.equal(run.usage.estimatedCostUsd, "0.00100000");
    assert.equal(repository.getSearchResults("run-1").length, 0);
  });
});

test("orchestrator enforces the overall timeout through the model-client signal", async () => {
  const client = createFakeClient({
    onResearch(request) {
      return new Promise((resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    },
  });

  await withHarness({ client, limits: defaultLimits({ timeoutMs: 20, maxRetries: 0 }) }, async ({ repository }) => {
    const run = repository.getSearchRun("run-1");
    assert.equal(run.status, "FAILED");
    assert.equal(run.error.code, "BUYER_DISCOVERY_TIMEOUT");
  });
});

test("orchestrator forwards user cancellation to an active model request", async () => {
  let signalObserved = false;
  let markResearchStarted;
  const researchStarted = new Promise((resolve) => { markResearchStarted = resolve; });
  const client = createFakeClient({
    onResearch(request) {
      signalObserved = request.signal instanceof AbortSignal;
      markResearchStarted();
      return new Promise((resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    },
  });

  await withHarness({
    client,
    limits: defaultLimits({ maxRetries: 0 }),
    async afterEnqueue({ runner }) {
      await researchStarted;
      assert.equal(await runner.cancel("run-1"), true);
    },
  }, async ({ repository }) => {
    assert.equal(signalObserved, true);
    assert.equal(repository.getSearchRun("run-1").status, "CANCELLED");
    assert.equal(repository.getSearchRun("run-1").error.code, "CANCELLED_BY_USER");
  });
});

test("orchestrator preserves incrementally saved candidates when a later verification fails", async () => {
  const candidates = [candidate("First Imports"), candidate("Second Imports")];
  const client = createFakeClient({
    candidates,
    onVerify(request, _candidate, callNumber) {
      if (callNumber === 2) {
        const error = new Error("Malformed verification output");
        error.name = "ZodError";
        throw error;
      }

      return {
        data: verified,
        metadata: metadata("verifier-1", request.model),
      };
    },
  });

  await withHarness({
    client,
    limits: defaultLimits({ verificationConcurrency: 1 }),
  }, async ({ repository }) => {
    const run = repository.getSearchRun("run-1");
    assert.equal(run.status, "FAILED");
    assert.equal(client.verifierCalls, 2);
    assert.equal(repository.getSearchResults("run-1").length, 1);
    assert.equal(repository.getSearchResults("run-1")[0].company.name, "First Imports");
  });
});

test("orchestrator never exceeds configured verification concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const candidates = ["One", "Two", "Three", "Four"].map((name) => candidate(`${name} Imports`));
  const client = createFakeClient({
    candidates,
    async onVerify(request, _candidate, callNumber) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        data: verified,
        metadata: metadata(`verifier-${callNumber}`, request.model),
      };
    },
  });

  await withHarness({
    client,
    limits: defaultLimits({ verificationConcurrency: 2 }),
  }, async ({ repository }) => {
    assert.equal(maximumActive, 2);
    assert.equal(repository.getSearchRun("run-1").status, "COMPLETED");
    assert.equal(repository.getSearchResults("run-1").length, 4);
  });
});
