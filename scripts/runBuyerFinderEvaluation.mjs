import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buyerFinderEvaluations } from "../test/fixtures/buyerFinderEvaluations.mjs";
import { createBuyerDiscoveryRuntime, readBuyerDiscoveryConfig } from "./buyerDiscoveryRuntime.mjs";
import { createSqliteBuyerRepository } from "./sqliteBuyerRepository.mjs";

const args = new Set(process.argv.slice(2));

if (!args.has("--confirm-live")) {
  console.error(
    "Live evaluation can consume OpenRouter credits. Re-run with --confirm-live after reviewing the selected fixtures and model variables.",
  );
  process.exitCode = 1;
} else if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is required for live buyer evaluation.");
  process.exitCode = 1;
} else {
  const baseline = readBuyerDiscoveryConfig(process.env);
  const candidateModels = {
    planner: process.env.BUYER_EVAL_CANDIDATE_PLANNER_MODEL || baseline.models.planner,
    research: process.env.BUYER_EVAL_CANDIDATE_RESEARCH_MODEL || baseline.models.research,
    formatter: process.env.BUYER_EVAL_CANDIDATE_FORMATTER_MODEL || baseline.models.formatter,
    verifier: process.env.BUYER_EVAL_CANDIDATE_VERIFIER_MODEL || baseline.models.verifier,
  };

  if (JSON.stringify(candidateModels) === JSON.stringify(baseline.models)) {
    console.error(
      "Set at least one BUYER_EVAL_CANDIDATE_*_MODEL variable to a different model before running a comparison.",
    );
    process.exitCode = 1;
  } else {
    const fixtures = selectFixtures(process.env.BUYER_EVAL_FIXTURES);
    const configurations = [
      { id: "baseline", models: baseline.models, limits: baseline.limits },
      { id: "candidate", models: candidateModels, limits: baseline.limits },
    ];
    const maximumRuns = positiveInteger(
      process.env.BUYER_EVAL_MAX_RUNS,
      24,
      "BUYER_EVAL_MAX_RUNS",
    );
    const plannedRuns = fixtures.length * configurations.length;

    if (plannedRuns > maximumRuns) {
      console.error(`Evaluation requires ${plannedRuns} runs, exceeding BUYER_EVAL_MAX_RUNS=${maximumRuns}.`);
      process.exitCode = 1;
    } else {
      const report = await runEvaluation(configurations, fixtures);
      const outputPath = resolve(
        process.env.BUYER_EVAL_OUTPUT ||
          join("data", "buyer-evaluations", `evaluation-${fileTimestamp(report.generatedAt)}.json`),
      );
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(`Buyer evaluation review file written to ${outputPath}`);
      console.log("Complete every candidate.review field, then run npm run buyer:eval:score -- <file>.");

      if (report.runs.some((run) => run.status !== "COMPLETED")) {
        process.exitCode = 1;
      }
    }
  }
}

async function runEvaluation(configurations, fixtures) {
  const generatedAt = new Date().toISOString();
  const runs = [];

  for (const configuration of configurations) {
    for (const fixture of fixtures) {
      console.error(`[${configuration.id}] Running ${fixture.id}...`);
      runs.push(await runFixture(configuration, fixture));
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    prompt: "Complete the review fields using the rubric in docs/BUYER_FINDER_EVALS.md.",
    configurations,
    runs,
  };
}

async function runFixture(configuration, fixture) {
  const directory = mkdtempSync(join(tmpdir(), "trade-tools-buyer-eval-"));
  const repository = createSqliteBuyerRepository(join(directory, "evaluation.sqlite"));
  const startedAt = performance.now();

  try {
    const runtime = createBuyerDiscoveryRuntime({
      repository,
      env: {
        ...process.env,
        BUYER_PLANNER_MODEL: configuration.models.planner,
        BUYER_RESEARCH_MODEL: configuration.models.research,
        BUYER_FORMATTER_MODEL: configuration.models.formatter,
        BUYER_VERIFIER_MODEL: configuration.models.verifier,
      },
    });
    const queued = runtime.start(fixture.input);
    await runtime.onIdle();
    const completed = repository.getSearchRun(queued.id);
    const results = repository.getSearchResults(queued.id);

    return {
      fixtureId: fixture.id,
      configurationId: configuration.id,
      description: fixture.description,
      expectedChallenge: fixture.expectedChallenge,
      input: fixture.input,
      status: completed?.status ?? "MISSING",
      error: completed?.error ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
      usage: completed?.usage ?? { inputTokens: 0, outputTokens: 0, estimatedCostUsd: "0" },
      summary: completed?.outcome?.summary ?? null,
      modelConfig: completed?.modelConfig ?? null,
      candidates: results.map((result, index) => ({
        rank: index + 1,
        matchId: result.id,
        companyName: result.company.name,
        websiteUrl: result.company.websiteUrl ?? null,
        confidence: result.confidence,
        sourceCount: result.sources.length,
        contactCount: result.contacts.length,
        sourcedContactCount: result.contacts.filter((contact) => Boolean(contact.sourceUrl)).length,
        sources: result.sources.map((source) => ({
          url: source.url,
          title: source.title,
          evidenceType: source.evidenceType,
          excerpt: source.excerpt ?? null,
        })),
        contacts: result.contacts.map((contact) => ({
          type: contact.type,
          value: contact.value,
          sourceUrl: contact.sourceUrl,
        })),
        review: {
          relevant: null,
          correctCountry: null,
          buyerRoleSupported: null,
          commodityRelationshipSupported: null,
          companyIdentityEstablished: null,
          contactSourceValid: result.contacts.length === 0 ? "NOT_PRESENT" : null,
          officialWebsiteIdentified: null,
          duplicate: null,
          unsupportedClaim: null,
          notes: "",
        },
      })),
    };
  } catch (error) {
    return {
      fixtureId: fixture.id,
      configurationId: configuration.id,
      description: fixture.description,
      expectedChallenge: fixture.expectedChallenge,
      input: fixture.input,
      status: "FAILED",
      error: { code: "EVALUATION_RUN_FAILED", message: safeErrorMessage(error) },
      latencyMs: Math.round(performance.now() - startedAt),
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: "0" },
      summary: null,
      modelConfig: null,
      candidates: [],
    };
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function selectFixtures(rawSelection) {
  if (!rawSelection || rawSelection.trim().toLowerCase() === "all") {
    return buyerFinderEvaluations;
  }

  const selectedIds = new Set(rawSelection.split(",").map((value) => value.trim()).filter(Boolean));
  const selected = buyerFinderEvaluations.filter((fixture) => selectedIds.has(fixture.id));
  const missing = [...selectedIds].filter((id) => !selected.some((fixture) => fixture.id === id));

  if (missing.length > 0) {
    throw new Error(`Unknown BUYER_EVAL_FIXTURES: ${missing.join(", ")}`);
  }

  return selected;
}

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function fileTimestamp(isoTimestamp) {
  return isoTimestamp.replaceAll(":", "-").replaceAll(".", "-");
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : "Buyer evaluation run failed.";
}
