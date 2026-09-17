import { join } from "node:path";

import { createSqliteBuyerRepository } from "./sqliteBuyerRepository.mjs";
import { createBuyerDiscoveryRuntime } from "./buyerDiscoveryRuntime.mjs";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is required. Add it to the local .env file before running buyer:pipeline.");
  process.exitCode = 1;
} else {
  const repository = createSqliteBuyerRepository(join(process.cwd(), "data", "costings.sqlite"));

  try {
    const runtime = createBuyerDiscoveryRuntime({ repository });
    const run = runtime.start({
      commodity: process.env.BUYER_SPIKE_COMMODITY ?? "Semi-husked coconut",
      targetCountry: process.env.BUYER_SPIKE_COUNTRY ?? "United Arab Emirates",
      ...(process.env.BUYER_SPIKE_AREA ? { targetArea: process.env.BUYER_SPIKE_AREA } : {}),
      buyerTypes: ["IMPORTER", "DISTRIBUTOR"],
      resultLimit: Number(process.env.BUYER_PIPELINE_RESULT_LIMIT ?? 3),
      requireWebsite: true,
      requireContact: false,
    });

    console.error(`Buyer search ${run.id} queued.`);
    await runtime.onIdle();

    const completed = repository.getSearchRun(run.id);
    const results = repository.getSearchResults(run.id);
    console.log(JSON.stringify({ run: completed, results }, null, 2));

    if (completed?.status !== "COMPLETED") {
      process.exitCode = 1;
    }
  } finally {
    repository.close();
  }
}
