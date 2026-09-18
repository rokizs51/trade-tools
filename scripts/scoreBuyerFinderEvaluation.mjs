import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateBuyerReleaseThresholds,
  scoreBuyerEvaluationConfiguration,
} from "../dist/domain/buyers/index.js";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run buyer:eval:score -- <evaluation-review.json>");
  process.exitCode = 1;
} else {
  const report = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  const completedRuns = report.runs.filter((run) => run.status === "COMPLETED");
  const assessments = completedRuns.map(toAssessment);
  const configurationIds = [...new Set(report.runs.map((run) => run.configurationId))];
  const configurations = configurationIds.map((configurationId) => {
    const configurationAssessments = assessments.filter((run) => run.configurationId === configurationId);
    const metrics = scoreBuyerEvaluationConfiguration(configurationAssessments);
    const failedRunCount = report.runs.filter(
      (run) => run.configurationId === configurationId && run.status !== "COMPLETED",
    ).length;
    const thresholds = evaluateBuyerReleaseThresholds(metrics);
    return {
      configurationId,
      failedRunCount,
      metrics,
      releaseThresholds: {
        ...thresholds,
        passed: failedRunCount === 0 && thresholds.passed,
      },
    };
  });

  console.log(JSON.stringify({
    schemaVersion: 1,
    sourceEvaluation: resolve(inputPath),
    scoredAt: new Date().toISOString(),
    failedRunCount: report.runs.length - completedRuns.length,
    configurations,
  }, null, 2));
}

function toAssessment(run) {
  return {
    fixtureId: run.fixtureId,
    configurationId: run.configurationId,
    requestedLimit: run.input.resultLimit,
    returnedCandidateCount: run.candidates.length,
    latencyMs: run.latencyMs,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    estimatedCostUsd: Number(run.usage.estimatedCostUsd),
    candidates: run.candidates.map((candidate) => ({
      rank: candidate.rank,
      companyName: candidate.companyName,
      sourceCount: candidate.sourceCount,
      contactCount: candidate.contactCount,
      sourcedContactCount: candidate.sourcedContactCount,
      relevant: requiredBoolean(candidate, "relevant"),
      correctCountry: requiredBoolean(candidate, "correctCountry"),
      buyerRoleSupported: requiredEnum(candidate, "buyerRoleSupported", ["YES", "NO", "UNCLEAR"]),
      commodityRelationshipSupported: requiredBoolean(candidate, "commodityRelationshipSupported"),
      companyIdentityEstablished: requiredBoolean(candidate, "companyIdentityEstablished"),
      contactSourceValid: requiredEnum(candidate, "contactSourceValid", ["YES", "NO", "NOT_PRESENT"]),
      officialWebsiteIdentified: requiredEnum(candidate, "officialWebsiteIdentified", ["YES", "NO", "UNCLEAR"]),
      duplicate: requiredBoolean(candidate, "duplicate"),
      unsupportedClaim: requiredBoolean(candidate, "unsupportedClaim"),
    })),
  };
}

function requiredBoolean(candidate, field) {
  const value = candidate.review?.[field];
  if (typeof value !== "boolean") {
    throw new Error(`${candidate.companyName}: review.${field} must be true or false.`);
  }
  return value;
}

function requiredEnum(candidate, field, allowed) {
  const value = candidate.review?.[field];
  if (!allowed.includes(value)) {
    throw new Error(`${candidate.companyName}: review.${field} must be one of ${allowed.join(", ")}.`);
  }
  return value;
}
