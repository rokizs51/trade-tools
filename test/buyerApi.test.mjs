import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBuyerApiHandler } from "../scripts/buyerApi.mjs";
import { createSqliteBuyerRepository } from "../scripts/sqliteBuyerRepository.mjs";

const validInput = {
  commodity: "Semi-husked coconut",
  targetCountry: "United Arab Emirates",
  buyerTypes: ["IMPORTER"],
};

function createIds(prefix = "id") {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function createRun(repository, id = "run-1") {
  return repository.createSearchRun({ ...validInput, resultLimit: 10 }, {
    now: "2026-09-18T01:00:00.000Z",
    createId: () => id,
  });
}

function createRuntimeStub(repository) {
  const ids = createIds("search");

  return {
    start(input) {
      return repository.createSearchRun(input, {
        now: "2026-09-18T01:00:00.000Z",
        createId: ids,
      });
    },
    cancel(id) {
      const run = repository.getSearchRun(id);

      if (!run || run.status !== "QUEUED") {
        return false;
      }

      repository.transitionSearchRun(id, "CANCELLED", {
        now: "2026-09-18T01:05:00.000Z",
        errorCode: "CANCELLED_BY_USER",
        errorMessage: "The buyer search was cancelled by the user.",
      });
      return true;
    },
  };
}

async function withApi(run, runtimeFactory = createRuntimeStub) {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-buyer-api-"));
  const repository = createSqliteBuyerRepository(join(dir, "trade-tools.sqlite"));
  const runtime = runtimeFactory ? runtimeFactory(repository) : undefined;
  const handler = createBuyerApiHandler({
    repository,
    runtime,
    now: () => "2026-09-18T02:00:00.000Z",
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const handled = await handler(request, response, url);

    if (!handled) {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({ repository, baseUrl });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

test("buyer API starts a validated search and returns 202 without waiting", async () => {
  await withApi(async ({ repository, baseUrl }) => {
    const { response, body } = await jsonRequest(baseUrl, "/api/buyer-searches", {
      method: "POST",
      body: JSON.stringify(validInput),
    });

    assert.equal(response.status, 202);
    assert.equal(body.status, "QUEUED");
    assert.equal(repository.getSearchRun(body.id).input.resultLimit, 10);
  });
});

test("buyer API returns stable 400 errors for invalid input and malformed JSON", async () => {
  await withApi(async ({ baseUrl }) => {
    const invalid = await jsonRequest(baseUrl, "/api/buyer-searches", {
      method: "POST",
      body: JSON.stringify({ commodity: "Coconut", targetCountry: "UAE", buyerTypes: [], resultLimit: 30 }),
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_REQUEST");
    assert.ok(invalid.body.error.details.issues.length >= 1);

    const malformed = await jsonRequest(baseUrl, "/api/buyer-searches", {
      method: "POST",
      body: "{broken",
    });
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.error.code, "INVALID_JSON");
  });
});

test("buyer API lists searches and returns polling-safe status records", async () => {
  await withApi(async ({ repository, baseUrl }) => {
    createRun(repository);
    repository.transitionSearchRun("run-1", "PLANNING", { now: "2026-09-18T01:01:00.000Z" });
    repository.transitionSearchRun("run-1", "RESEARCHING", { now: "2026-09-18T01:02:00.000Z" });
    repository.transitionSearchRun("run-1", "VERIFYING", { now: "2026-09-18T01:03:00.000Z" });
    repository.transitionSearchRun("run-1", "SAVING", {
      now: "2026-09-18T01:04:00.000Z",
      outcome: {
        summary: { researchedCandidateCount: 3, savedCandidateCount: 1, rejectedCandidateCount: 2 },
        decisions: [],
      },
    });

    const list = await jsonRequest(baseUrl, "/api/buyer-searches");
    assert.equal(list.response.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].commodity, "Semi-husked coconut");
    assert.equal("modelConfig" in list.body[0], false);

    const status = await jsonRequest(baseUrl, "/api/buyer-searches/run-1");
    assert.equal(status.response.status, 200);
    assert.equal(status.body.progress.total, 10);
    assert.deepEqual(status.body.input.buyerTypes, ["IMPORTER"]);
    assert.equal(status.body.outcome.summary.savedCandidateCount, 1);
    assert.equal(list.body[0].summary.researchedCandidateCount, 3);

    const missing = await jsonRequest(baseUrl, "/api/buyer-searches/missing");
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, "BUYER_SEARCH_NOT_FOUND");
  });
});

test("buyer API returns ranked results with public contact provenance", async () => {
  await withApi(async ({ repository, baseUrl }) => {
    createRun(repository);
    const sourceUrl = "https://example.com/contact";
    repository.saveCandidateBundle("run-1", {
      company: {
        name: "Example Imports LLC",
        websiteUrl: "https://example.com",
        countryName: "United Arab Emirates",
        countryCode: "AE",
        city: "Dubai",
      },
      match: {
        commodity: "Semi-husked coconut",
        buyerType: "IMPORTER",
        commodityRelationship: "Imports coconut products.",
        confidenceScore: 90,
        confidenceLevel: "HIGH",
        verificationStatus: "VERIFIED",
      },
      sources: [{
        url: sourceUrl,
        title: "Example Imports contact",
        evidenceType: "CONTACT",
        retrievedAt: "2026-09-18T01:10:00.000Z",
      }],
      contacts: [{
        type: "EMAIL",
        value: "sales@example.com",
        sourceUrl,
        isPublicBusinessContact: true,
      }],
    }, {
      now: "2026-09-18T01:10:00.000Z",
      createId: createIds("result"),
    });

    const { response, body } = await jsonRequest(baseUrl, "/api/buyer-searches/run-1/results");
    assert.equal(response.status, 200);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].company.name, "Example Imports LLC");
    assert.equal(body.results[0].contacts[0].sourceUrl, sourceUrl);
    assert.equal("normalizedName" in body.results[0].company, false);
  });
});

test("buyer API cancels active searches and rejects repeated cancellation", async () => {
  await withApi(async ({ repository, baseUrl }) => {
    createRun(repository);

    const cancelled = await jsonRequest(baseUrl, "/api/buyer-searches/run-1/cancel", { method: "POST" });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "CANCELLED");

    const repeated = await jsonRequest(baseUrl, "/api/buyer-searches/run-1/cancel", { method: "POST" });
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.body.error.code, "INVALID_SEARCH_STATE");
  });
});

test("buyer API updates candidate review status and handles unknown candidates", async () => {
  await withApi(async ({ repository, baseUrl }) => {
    createRun(repository);
    const saved = repository.saveCandidateBundle("run-1", {
      company: { name: "Review Imports", countryName: "United Arab Emirates" },
      match: {
        commodity: "Coconut",
        buyerType: "IMPORTER",
        commodityRelationship: "Imports coconut.",
        confidenceScore: 75,
        confidenceLevel: "MEDIUM",
        verificationStatus: "VERIFIED",
      },
      sources: [{
        url: "https://review.example/evidence",
        title: "Evidence",
        evidenceType: "BUYER_ROLE",
        retrievedAt: "2026-09-18T01:10:00.000Z",
      }],
      contacts: [],
    }, {
      now: "2026-09-18T01:10:00.000Z",
      createId: createIds("review"),
    });

    const reviewed = await jsonRequest(baseUrl, `/api/buyer-matches/${saved.id}/review`, {
      method: "PATCH",
      body: JSON.stringify({ status: "APPROVED" }),
    });
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.reviewStatus, "APPROVED");

    const invalid = await jsonRequest(baseUrl, `/api/buyer-matches/${saved.id}/review`, {
      method: "PATCH",
      body: JSON.stringify({ status: "MAYBE" }),
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_REQUEST");

    const missing = await jsonRequest(baseUrl, "/api/buyer-matches/missing/review", {
      method: "PATCH",
      body: JSON.stringify({ status: "REJECTED" }),
    });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, "BUYER_MATCH_NOT_FOUND");
  });
});

test("buyer API reports unavailable runtime and full queue safely", async () => {
  await withApi(async ({ baseUrl }) => {
    const unavailable = await jsonRequest(baseUrl, "/api/buyer-searches", {
      method: "POST",
      body: JSON.stringify(validInput),
    });
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.body.error.code, "BUYER_FINDER_NOT_CONFIGURED");
  }, null);

  await withApi(async ({ baseUrl }) => {
    const full = await jsonRequest(baseUrl, "/api/buyer-searches", {
      method: "POST",
      body: JSON.stringify(validInput),
    });
    assert.equal(full.response.status, 429);
    assert.equal(full.body.error.code, "BUYER_SEARCH_QUEUE_FULL");
  }, () => ({
    start() {
      throw Object.assign(new Error("Queue full."), { code: "BUYER_SEARCH_QUEUE_FULL" });
    },
  }));
});
