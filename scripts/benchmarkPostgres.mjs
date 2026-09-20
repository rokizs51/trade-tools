import { performance } from "node:perf_hooks";

import { createPersistence } from "./persistence.mjs";

const iterations = readIterations(process.argv.slice(2));
const persistence = createPersistence();

if (persistence.provider !== "postgres") {
  await persistence.close();
  throw new Error("The database benchmark requires DATABASE_PROVIDER=postgres and DATABASE_URL.");
}

try {
  const coldCostings = await measureOnce(() => persistence.costingRepository.list());
  const costings = await measureMany(() => persistence.costingRepository.list(), iterations);
  const loadPlans = await measureMany(() => persistence.loadPlanRepository.list(), iterations);
  const searchRuns = await measureMany(() => persistence.buyerRepository.listSearchRuns(), iterations);
  const latestRun = searchRuns.value[0];
  const buyerResults = latestRun
    ? await measureMany(() => persistence.buyerRepository.getSearchResults(latestRun.id), iterations)
    : undefined;

  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    iterations,
    databaseProvider: persistence.provider,
    coldConnectionAndCostingListMs: round(coldCostings.durationMs),
    warm: {
      costingList: summarize(costings),
      loadPlanList: summarize(loadPlans),
      buyerSearchList: summarize(searchRuns),
      buyerResultHydration: buyerResults ? summarize(buyerResults) : { skipped: "No buyer search run exists." },
    },
  }, null, 2));
} finally {
  await persistence.close();
}

async function measureOnce(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - startedAt };
}

async function measureMany(operation, count) {
  const durationsMs = [];
  let value;
  for (let index = 0; index < count; index += 1) {
    const measurement = await measureOnce(operation);
    value = measurement.value;
    durationsMs.push(measurement.durationMs);
  }
  return { value, durationsMs };
}

function summarize(measurement) {
  const sorted = [...measurement.durationsMs].sort((left, right) => left - right);
  return {
    samplesMs: measurement.durationsMs.map(round),
    medianMs: round(sorted[Math.floor(sorted.length / 2)]),
    resultCount: Array.isArray(measurement.value) ? measurement.value.length : undefined,
  };
}

function readIterations(args) {
  const argument = args.find((value) => value.startsWith("--iterations="));
  const value = argument ? Number(argument.slice("--iterations=".length)) : 3;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("--iterations must be an integer between 1 and 20.");
  }
  return value;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
