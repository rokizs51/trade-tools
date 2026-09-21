import assert from "node:assert/strict";
import test from "node:test";

import { createBuyerPipelineLogger } from "../scripts/buyerPipelineLogger.mjs";

test("Buyer Finder pipeline logger emits structured safe event records", () => {
  const records = [];
  const logger = createBuyerPipelineLogger({
    now: () => "2026-09-21T09:30:00.000Z",
    consoleImplementation: {
      log: (value) => records.push({ method: "log", value }),
      warn: (value) => records.push({ method: "warn", value }),
      error: (value) => records.push({ method: "error", value }),
    },
  });

  logger.event({
    runId: "run-1",
    level: "ERROR",
    eventType: "SEARCH_FAILED",
    message: "Search stopped because a pipeline stage failed.",
    details: { errorCode: "UPSTREAM_UNAVAILABLE" },
  });

  assert.equal(records[0].method, "error");
  assert.deepEqual(JSON.parse(records[0].value), {
    timestamp: "2026-09-21T09:30:00.000Z",
    scope: "buyer-finder",
    runId: "run-1",
    level: "ERROR",
    eventType: "SEARCH_FAILED",
    message: "Search stopped because a pipeline stage failed.",
    details: { errorCode: "UPSTREAM_UNAVAILABLE" },
  });
});
