import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBuyerSearchJobRunner } from "../scripts/buyerSearchJobRunner.mjs";
import { createSqliteBuyerRepository } from "../scripts/sqliteBuyerRepository.mjs";

const input = {
  commodity: "Coconut",
  targetCountry: "United Arab Emirates",
  buyerTypes: ["IMPORTER"],
  resultLimit: 10,
};

function withRepository(run) {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-buyer-jobs-"));
  const repository = createSqliteBuyerRepository(join(dir, "trade-tools.sqlite"));

  return Promise.resolve()
    .then(() => run(repository))
    .finally(() => {
      repository.close();
      rmSync(dir, { recursive: true, force: true });
    });
}

function createRun(repository, id) {
  repository.createSearchRun(input, {
    now: "2026-09-17T07:00:00.000Z",
    createId: () => id,
  });
}

test("job runner executes one search at a time and completes valid lifecycles", async () => {
  await withRepository(async (repository) => {
    createRun(repository, "run-1");
    createRun(repository, "run-2");
    let active = 0;
    let maximumActive = 0;

    const runner = createBuyerSearchJobRunner({
      repository,
      recoverStaleRuns: false,
      execute: async (job) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        await job.transition("RESEARCHING");
        await job.transition("VERIFYING");
        await job.updateProgress({ current: 1, total: 1 });
        await job.transition("SAVING");
        active -= 1;
      },
    });

    assert.equal(await runner.enqueue("run-1"), true);
    assert.equal(await runner.enqueue("run-2"), true);
    await runner.onIdle();

    assert.equal(maximumActive, 1);
    assert.equal(repository.getSearchRun("run-1").status, "COMPLETED");
    assert.equal(repository.getSearchRun("run-2").status, "COMPLETED");
  });
});

test("job runner cancels queued searches without executing them", async () => {
  await withRepository(async (repository) => {
    createRun(repository, "blocker");
    createRun(repository, "run-1");
    let executions = 0;
    let releaseBlocker;
    const blocker = new Promise((resolve) => { releaseBlocker = resolve; });
    const runner = createBuyerSearchJobRunner({
      repository,
      recoverStaleRuns: false,
      execute: async (job) => {
        if (job.runId === "blocker") {
          await blocker;
          await job.transition("RESEARCHING");
          await job.transition("VERIFYING");
          await job.transition("SAVING");
          return;
        }
        executions += 1;
      },
    });

    await runner.enqueue("blocker");
    await runner.enqueue("run-1");
    assert.equal(await runner.cancel("run-1"), true);
    releaseBlocker();
    await runner.onIdle();

    assert.equal(executions, 0);
    assert.equal(repository.getSearchRun("run-1").status, "CANCELLED");
  });
});

test("job runner aborts and cancels a running search", async () => {
  await withRepository(async (repository) => {
    createRun(repository, "run-1");
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    const runner = createBuyerSearchJobRunner({
      repository,
      recoverStaleRuns: false,
      execute: ({ signal }) => new Promise((resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    await runner.enqueue("run-1");
    await didStart;
    assert.equal(await runner.cancel("run-1"), true);
    await runner.onIdle();

    assert.equal(repository.getSearchRun("run-1").status, "CANCELLED");
    assert.equal(repository.getSearchRun("run-1").error.code, "CANCELLED_BY_USER");
  });
});

test("job runner records worker failures without blocking the next job", async () => {
  await withRepository(async (repository) => {
    createRun(repository, "failed-run");
    createRun(repository, "next-run");
    const runner = createBuyerSearchJobRunner({
      repository,
      recoverStaleRuns: false,
      execute: async (job) => {
        if (job.runId === "failed-run") {
          throw new Error("Upstream unavailable");
        }

        await job.transition("RESEARCHING");
        await job.transition("VERIFYING");
        await job.transition("SAVING");
      },
    });

    await runner.enqueue("failed-run");
    await runner.enqueue("next-run");
    await runner.onIdle();

    assert.equal(repository.getSearchRun("failed-run").status, "FAILED");
    assert.equal(repository.getSearchRun("failed-run").error.message, "Upstream unavailable");
    assert.equal(repository.getSearchRun("next-run").status, "COMPLETED");
  });
});

test("job runner recovery interrupts stale runs when it starts", async () => {
  await withRepository(async (repository) => {
    createRun(repository, "stale-run");
    const runner = createBuyerSearchJobRunner({
      repository,
      now: () => "2026-09-17T12:00:00.000Z",
      execute: async () => {},
    });

    await runner.onIdle();
    assert.equal(repository.getSearchRun("stale-run").status, "INTERRUPTED");
  });
});

test("job runner records a safe lifecycle timeline when the repository supports events", async () => {
  await withRepository(async (repository) => {
    createRun(repository, "run-events");
    const events = [];
    const consoleEvents = [];
    repository.recordSearchEvent = async (searchRunId, event, options) => {
      events.push({ searchRunId, ...event, createdAt: options.now });
    };

    const runner = createBuyerSearchJobRunner({
      repository,
      recoverStaleRuns: false,
      now: () => "2026-09-21T09:30:00.000Z",
      logger: { event: (event) => consoleEvents.push(event) },
      execute: async (job) => {
        await job.updateProgress({ current: 0, total: 1, stage: "Searching sources" });
        await job.transition("RESEARCHING");
        await job.transition("VERIFYING");
        await job.transition("SAVING");
      },
    });

    await runner.enqueue("run-events");
    await runner.onIdle();

    assert.deepEqual(events.map((event) => event.eventType), [
      "STATUS_CHANGED",
      "SEARCH_PROGRESS",
      "STATUS_CHANGED",
      "STATUS_CHANGED",
      "STATUS_CHANGED",
      "STATUS_CHANGED",
    ]);
    assert.equal(events.at(-1).details.status, "COMPLETED");
    assert.equal(consoleEvents.length, events.length);
  });
});
