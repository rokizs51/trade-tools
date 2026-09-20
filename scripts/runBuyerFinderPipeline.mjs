import { createBuyerDiscoveryRuntime } from "./buyerDiscoveryRuntime.mjs";
import { createPersistence } from "./persistence.mjs";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is required. Add it to the local .env file before running buyer:pipeline.");
  process.exitCode = 1;
} else {
  const persistence = createPersistence();
  const repository = persistence.buyerRepository;

  try {
    const runtime = createBuyerDiscoveryRuntime({ repository });
    const run = await runtime.start({
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

    const completed = await repository.getSearchRun(run.id);
    const results = await repository.getSearchResults(run.id);
    console.log(JSON.stringify({ run: completed, results }, null, 2));

    if (completed?.status !== "COMPLETED") {
      process.exitCode = 1;
    }
  } finally {
    await persistence.close();
  }
}
