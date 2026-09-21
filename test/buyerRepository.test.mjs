import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteBuyerRepository } from "../scripts/sqliteBuyerRepository.mjs";
import { InvalidSearchRunTransitionError } from "../dist/application/buyerDiscovery/index.js";

const searchInput = {
  commodity: "Semi-husked coconut",
  targetCountry: "United Arab Emirates",
  targetArea: "Dubai",
  buyerTypes: ["IMPORTER", "DISTRIBUTOR"],
  resultLimit: 10,
  requireWebsite: true,
};

function createIds(prefix = "id") {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function makeBundle(overrides = {}) {
  const sourceUrl = "https://Example.com/contact?utm_source=test";

  return {
    company: {
      name: "Example Trading LLC",
      websiteUrl: "http://www.example.com/",
      countryName: "United Arab Emirates",
      countryCode: "AE",
      city: "Dubai",
      address: "Business Bay, Dubai",
    },
    match: {
      commodity: "Semi-husked coconut",
      buyerType: "IMPORTER",
      commodityRelationship: "Lists coconut products in its import catalogue.",
      confidenceScore: 90,
      confidenceLevel: "HIGH",
      verificationStatus: "VERIFIED",
    },
    sources: [
      {
        url: sourceUrl,
        title: "Example Trading contact and products",
        publisher: "Example Trading",
        evidenceType: "CONTACT",
        excerpt: "Public sales contact and coconut product listing.",
        retrievedAt: "2026-09-17T08:00:00.000Z",
      },
    ],
    contacts: [
      {
        type: "EMAIL",
        value: " Sales@Example.com ",
        label: "Sales",
        sourceUrl,
        isPublicBusinessContact: true,
      },
    ],
    ...overrides,
  };
}

function withRepository(run) {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-buyers-"));
  const dbPath = join(dir, "trade-tools.sqlite");
  const repository = createSqliteBuyerRepository(dbPath);

  try {
    return run(repository, dbPath);
  } finally {
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function createRun(repository, id = "run-1", now = "2026-09-17T07:00:00.000Z") {
  return repository.createSearchRun(searchInput, {
    now,
    createId: () => id,
    modelConfig: { planner: "google/gemini-3.5-flash-lite" },
  });
}

test("buyer repository creates, lists, and reopens durable search runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-buyers-reopen-"));
  const dbPath = join(dir, "trade-tools.sqlite");

  try {
    const first = createSqliteBuyerRepository(dbPath);
    const created = createRun(first);
    first.close();

    const reopened = createSqliteBuyerRepository(dbPath);
    assert.equal(reopened.getSearchRun(created.id)?.input.targetArea, "Dubai");
    assert.equal(reopened.getSearchRun(created.id)?.modelConfig.planner, "google/gemini-3.5-flash-lite");
    assert.equal(reopened.listSearchRuns().length, 1);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buyer repository enforces lifecycle transitions and records progress", () => {
  withRepository((repository) => {
    createRun(repository);

    const planning = repository.transitionSearchRun("run-1", "PLANNING", {
      now: "2026-09-17T07:01:00.000Z",
      plan: { searchQueries: ["coconut importer Dubai"] },
    });
    assert.equal(planning.status, "PLANNING");
    assert.equal(planning.startedAt, "2026-09-17T07:01:00.000Z");
    assert.deepEqual(planning.plan.searchQueries, ["coconut importer Dubai"]);

    const progressed = repository.updateSearchRunProgress("run-1", {
      current: 2,
      total: 10,
      stage: "Preparing search queries",
    }, "2026-09-17T07:02:00.000Z");
    assert.deepEqual(progressed.progress, { current: 2, total: 10 });

    assert.throws(
      () => repository.transitionSearchRun("run-1", "COMPLETED", { now: "2026-09-17T07:03:00.000Z" }),
      InvalidSearchRunTransitionError,
    );

    repository.transitionSearchRun("run-1", "RESEARCHING", { now: "2026-09-17T07:03:00.000Z" });
    repository.transitionSearchRun("run-1", "VERIFYING", { now: "2026-09-17T07:04:00.000Z" });
    const saving = repository.transitionSearchRun("run-1", "SAVING", {
      now: "2026-09-17T07:05:00.000Z",
      outcome: {
        summary: { researchedCandidateCount: 3, savedCandidateCount: 1, rejectedCandidateCount: 2 },
        decisions: [{ companyName: "Rejected Co", isEligible: false, rejectionReasons: ["Missing buyer-role evidence."] }],
      },
    });
    assert.equal(saving.outcome.summary.researchedCandidateCount, 3);
    assert.equal(saving.outcome.decisions[0].companyName, "Rejected Co");
  });
});

test("buyer repository saves a candidate, evidence, and sourced contacts transactionally", () => {
  withRepository((repository) => {
    createRun(repository);
    const saved = repository.saveCandidateBundle("run-1", makeBundle(), {
      now: "2026-09-17T08:05:00.000Z",
      createId: createIds("entity"),
    });

    assert.equal(saved.company.normalizedName, "example trading");
    assert.equal(saved.company.websiteDomain, "example.com");
    assert.equal(saved.sources[0].normalizedUrl, "https://example.com/contact");
    assert.equal(saved.contacts[0].value, "sales@example.com");
    assert.equal(saved.contacts[0].sourceId, saved.sources[0].id);
    assert.equal(repository.getSearchResults("run-1").length, 1);
  });
});

test("buyer repository rolls back the whole candidate bundle when contact provenance is invalid", () => {
  withRepository((repository, dbPath) => {
    createRun(repository);
    const invalid = makeBundle({
      contacts: [{
        type: "EMAIL",
        value: "sales@example.com",
        sourceUrl: "https://unrelated.example/contact",
        isPublicBusinessContact: true,
      }],
    });

    assert.throws(
      () => repository.saveCandidateBundle("run-1", invalid, {
        now: "2026-09-17T08:05:00.000Z",
        createId: createIds("rollback"),
      }),
      /Contact source is not present/,
    );
    assert.equal(repository.getSearchResults("run-1").length, 0);

    const inspectionDb = new DatabaseSync(dbPath);
    assert.equal(inspectionDb.prepare("SELECT COUNT(*) AS count FROM buyer_companies").get().count, 0);
    assert.equal(inspectionDb.prepare("SELECT COUNT(*) AS count FROM buyer_sources").get().count, 0);
    inspectionDb.close();
  });
});

test("buyer repository refuses candidates without evidence or with non-public contacts", () => {
  withRepository((repository) => {
    createRun(repository);
    const options = {
      now: "2026-09-17T08:05:00.000Z",
      createId: createIds("guard"),
    };

    assert.throws(
      () => repository.saveCandidateBundle("run-1", makeBundle({ sources: [], contacts: [] }), options),
      /at least one evidence source/,
    );
    assert.throws(
      () => repository.saveCandidateBundle("run-1", makeBundle({
        contacts: [{
          ...makeBundle().contacts[0],
          isPublicBusinessContact: false,
        }],
      }), options),
      /Only sourced public business contacts/,
    );
    assert.equal(repository.getSearchResults("run-1").length, 0);
  });
});

test("buyer repository reuses a company by canonical domain across searches", () => {
  withRepository((repository) => {
    createRun(repository, "run-1");
    createRun(repository, "run-2", "2026-09-17T09:00:00.000Z");
    const ids = createIds("shared");
    const first = repository.saveCandidateBundle("run-1", makeBundle(), {
      now: "2026-09-17T09:05:00.000Z",
      createId: ids,
    });
    const second = repository.saveCandidateBundle("run-2", makeBundle({
      company: {
        ...makeBundle().company,
        name: "Example Trading Company Limited",
        websiteUrl: "https://example.com/about",
      },
      match: { ...makeBundle().match, buyerType: "DISTRIBUTOR" },
      contacts: [],
    }), {
      now: "2026-09-17T09:10:00.000Z",
      createId: ids,
    });

    assert.equal(second.company.id, first.company.id);
    assert.equal(repository.getSearchResults("run-1").length, 1);
    assert.equal(repository.getSearchResults("run-2").length, 1);
  });
});

test("buyer repository deletes terminal searches, cascades dependent records, and prunes only orphaned companies", () => {
  withRepository((repository, dbPath) => {
    createRun(repository, "run-1");
    completeRun(repository, "run-1");
    repository.saveCandidateBundle("run-1", makeBundle(), {
      now: "2026-09-17T09:05:00.000Z",
      createId: createIds("delete"),
    });

    const deleted = repository.deleteSearchRun("run-1");
    assert.deepEqual(deleted, { id: "run-1", orphanedCompanyCount: 1 });
    assert.equal(repository.getSearchRun("run-1"), undefined);

    const inspectionDb = new DatabaseSync(dbPath);
    assert.equal(inspectionDb.prepare("SELECT COUNT(*) AS count FROM buyer_matches").get().count, 0);
    assert.equal(inspectionDb.prepare("SELECT COUNT(*) AS count FROM buyer_sources").get().count, 0);
    assert.equal(inspectionDb.prepare("SELECT COUNT(*) AS count FROM buyer_contacts").get().count, 0);
    assert.equal(inspectionDb.prepare("SELECT COUNT(*) AS count FROM buyer_companies").get().count, 0);
    inspectionDb.close();

    createRun(repository, "active-run");
    assert.throws(() => repository.deleteSearchRun("active-run"), /cannot be deleted while its status is QUEUED/);
  });
});

test("buyer repository updates candidate review state", () => {
  withRepository((repository) => {
    createRun(repository);
    const saved = repository.saveCandidateBundle("run-1", makeBundle(), {
      now: "2026-09-17T08:05:00.000Z",
      createId: createIds("review"),
    });

    const approved = repository.updateMatchReviewStatus(
      saved.id,
      "APPROVED",
      "2026-09-17T10:00:00.000Z",
    );
    assert.equal(approved.reviewStatus, "APPROVED");
    assert.equal(approved.reviewedAt, "2026-09-17T10:00:00.000Z");

    const reset = repository.updateMatchReviewStatus(
      saved.id,
      "NEW",
      "2026-09-17T10:05:00.000Z",
    );
    assert.equal(reset.reviewedAt, null);
  });
});

test("buyer repository interrupts every stale non-terminal search", () => {
  withRepository((repository) => {
    createRun(repository, "queued");
    createRun(repository, "running");
    repository.transitionSearchRun("running", "PLANNING", { now: "2026-09-17T07:01:00.000Z" });
    createRun(repository, "completed");
    repository.transitionSearchRun("completed", "PLANNING", { now: "2026-09-17T07:01:00.000Z" });
    repository.transitionSearchRun("completed", "RESEARCHING", { now: "2026-09-17T07:02:00.000Z" });
    repository.transitionSearchRun("completed", "VERIFYING", { now: "2026-09-17T07:03:00.000Z" });
    repository.transitionSearchRun("completed", "SAVING", { now: "2026-09-17T07:04:00.000Z" });
    repository.transitionSearchRun("completed", "COMPLETED", { now: "2026-09-17T07:05:00.000Z" });

    assert.equal(repository.interruptStaleSearchRuns("2026-09-17T11:00:00.000Z"), 2);
    assert.equal(repository.getSearchRun("queued").status, "INTERRUPTED");
    assert.equal(repository.getSearchRun("running").error.code, "SERVER_RESTARTED");
    assert.equal(repository.getSearchRun("completed").status, "COMPLETED");
  });
});

function completeRun(repository, id) {
  repository.transitionSearchRun(id, "PLANNING", { now: "2026-09-17T07:01:00.000Z" });
  repository.transitionSearchRun(id, "RESEARCHING", { now: "2026-09-17T07:02:00.000Z" });
  repository.transitionSearchRun(id, "VERIFYING", { now: "2026-09-17T07:03:00.000Z" });
  repository.transitionSearchRun(id, "SAVING", { now: "2026-09-17T07:04:00.000Z" });
  repository.transitionSearchRun(id, "COMPLETED", { now: "2026-09-17T07:05:00.000Z" });
}
