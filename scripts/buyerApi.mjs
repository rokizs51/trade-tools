import { z } from "zod";

import {
  BuyerSearchInputSchema,
  CandidateReviewStatusSchema,
} from "../dist/domain/buyers/index.js";
import { InvalidSearchRunTransitionError } from "../dist/application/buyerDiscovery/index.js";
import {
  BuyerMatchNotFoundError,
  BuyerSearchRunNotFoundError,
} from "./buyerRepositoryErrors.mjs";

const ReviewRequestSchema = z.object({ status: CandidateReviewStatusSchema }).strict();
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]);

class InvalidJsonError extends Error {
  constructor() {
    super("Request body must contain valid JSON.");
    this.name = "InvalidJsonError";
    this.code = "INVALID_JSON";
  }
}

class RequestBodyTooLargeError extends Error {
  constructor(maximumBytes) {
    super(`Request body cannot exceed ${maximumBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
    this.code = "REQUEST_BODY_TOO_LARGE";
  }
}

export function createBuyerApiHandler({ repository, runtime, now = () => new Date().toISOString() }) {
  return async function handleBuyerApiRequest(request, response, url) {
    if (!url.pathname.startsWith("/api/buyer-searches") &&
        !url.pathname.startsWith("/api/buyer-matches")) {
      return false;
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/buyer-searches") {
        if (!runtime) {
          sendError(response, 503, "BUYER_FINDER_NOT_CONFIGURED", "Buyer Finder requires OPENROUTER_API_KEY on the server.");
          return true;
        }

        const input = BuyerSearchInputSchema.parse(await readJsonBody(request));
        const run = await runtime.start(input);
        sendJson(response, 202, { id: run.id, status: run.status });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/api/buyer-searches") {
        sendJson(response, 200, (await repository.listSearchRuns()).map(toSearchListItem));
        return true;
      }

      const resultsMatch = url.pathname.match(/^\/api\/buyer-searches\/([^/]+)\/results$/);
      const cancelMatch = url.pathname.match(/^\/api\/buyer-searches\/([^/]+)\/cancel$/);
      const searchMatch = url.pathname.match(/^\/api\/buyer-searches\/([^/]+)$/);
      const reviewMatch = url.pathname.match(/^\/api\/buyer-matches\/([^/]+)\/review$/);

      if (request.method === "GET" && resultsMatch) {
        const id = decodePathPart(resultsMatch[1]);
        const run = await repository.getSearchRun(id);

        if (!run) {
          sendError(response, 404, "BUYER_SEARCH_NOT_FOUND", "Buyer search was not found.");
          return true;
        }

        sendJson(response, 200, {
          searchId: id,
          status: run.status,
          results: (await repository.getSearchResults(id)).map(toApiResult),
        });
        return true;
      }

      if (request.method === "POST" && cancelMatch) {
        const id = decodePathPart(cancelMatch[1]);
        const run = await repository.getSearchRun(id);

        if (!run) {
          sendError(response, 404, "BUYER_SEARCH_NOT_FOUND", "Buyer search was not found.");
          return true;
        }

        if (TERMINAL_STATUSES.has(run.status)) {
          sendError(response, 409, "INVALID_SEARCH_STATE", `A ${run.status.toLowerCase()} search cannot be cancelled.`);
          return true;
        }

        if (!runtime) {
          sendError(response, 503, "BUYER_FINDER_NOT_CONFIGURED", "Buyer Finder runtime is not available.");
          return true;
        }

        if (!await runtime.cancel(id)) {
          sendError(response, 409, "INVALID_SEARCH_STATE", "The buyer search is not queued or running in this process.");
          return true;
        }

        sendJson(response, 200, toSearchStatus(await repository.getSearchRun(id)));
        return true;
      }

      if (request.method === "GET" && searchMatch) {
        const run = await repository.getSearchRun(decodePathPart(searchMatch[1]));

        if (!run) {
          sendError(response, 404, "BUYER_SEARCH_NOT_FOUND", "Buyer search was not found.");
          return true;
        }

        sendJson(response, 200, toSearchStatus(run));
        return true;
      }

      if (request.method === "PATCH" && reviewMatch) {
        const body = ReviewRequestSchema.parse(await readJsonBody(request));
        const match = await repository.updateMatchReviewStatus(
          decodePathPart(reviewMatch[1]),
          body.status,
          now(),
        );
        sendJson(response, 200, toApiResult(match));
        return true;
      }

      sendError(response, 404, "API_ROUTE_NOT_FOUND", "Buyer Finder API route was not found.");
      return true;
    } catch (error) {
      handleApiError(response, error);
      return true;
    }
  };
}

function handleApiError(response, error) {
  if (error instanceof z.ZodError) {
    sendError(response, 400, "INVALID_REQUEST", "Request validation failed.", {
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  if (error instanceof InvalidJsonError) {
    sendError(response, 400, error.code, error.message);
    return;
  }

  if (error instanceof RequestBodyTooLargeError) {
    sendError(response, 413, error.code, error.message);
    return;
  }

  if (error instanceof URIError) {
    sendError(response, 400, "INVALID_PATH_PARAMETER", "Path parameter is not valid URL encoding.");
    return;
  }

  if (error instanceof BuyerSearchRunNotFoundError) {
    sendError(response, 404, "BUYER_SEARCH_NOT_FOUND", "Buyer search was not found.");
    return;
  }

  if (error instanceof BuyerMatchNotFoundError) {
    sendError(response, 404, "BUYER_MATCH_NOT_FOUND", "Buyer candidate was not found.");
    return;
  }

  if (error instanceof InvalidSearchRunTransitionError) {
    sendError(response, 409, error.code, error.message);
    return;
  }

  if (error && typeof error === "object" && error.code === "BUYER_SEARCH_QUEUE_FULL") {
    sendError(response, 429, error.code, error.message);
    return;
  }

  console.error("Buyer Finder API error:", error instanceof Error ? error.message : error);
  sendError(response, 500, "INTERNAL_ERROR", "Buyer Finder encountered an internal error.");
}

function toSearchListItem(run) {
  return {
    id: run.id,
    status: run.status,
    commodity: run.commodity,
    targetCountry: run.targetCountry,
    ...(run.targetArea ? { targetArea: run.targetArea } : {}),
    requestedLimit: run.requestedLimit,
    currentStage: run.currentStage,
    progress: run.progress,
    summary: run.outcome?.summary ?? null,
    error: run.error,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
  };
}

function toSearchStatus(run) {
  return {
    id: run.id,
    status: run.status,
    input: run.input,
    currentStage: run.currentStage,
    progress: run.progress,
    usage: run.usage,
    outcome: run.outcome,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
  };
}

function toApiResult(match) {
  return {
    id: match.id,
    company: {
      id: match.company.id,
      name: match.company.name,
      websiteUrl: match.company.websiteUrl,
      countryCode: match.company.countryCode,
      countryName: match.company.countryName,
      city: match.company.city,
      address: match.company.address,
    },
    commodity: match.commodity,
    buyerType: match.buyerType,
    commodityRelationship: match.commodityRelationship,
    confidence: match.confidence,
    verificationStatus: match.verificationStatus,
    reviewStatus: match.reviewStatus,
    rejectionReason: match.rejectionReason,
    reviewedAt: match.reviewedAt,
    sources: match.sources.map((source) => ({
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      evidenceType: source.evidenceType,
      excerpt: source.excerpt,
      retrievedAt: source.retrievedAt,
    })),
    contacts: match.contacts.map((contact) => ({
      type: contact.type,
      value: contact.value,
      label: contact.label,
      isPublicBusinessContact: contact.isPublicBusinessContact,
      sourceUrl: contact.sourceUrl,
    })),
  };
}

function decodePathPart(value) {
  return decodeURIComponent(value);
}

async function readJsonBody(request, maximumBytes = 64 * 1024) {
  const chunks = [];
  let length = 0;

  for await (const chunk of request) {
    length += chunk.length;

    if (length > maximumBytes) {
      throw new RequestBodyTooLargeError(maximumBytes);
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidJsonError();
  }
}

function sendError(response, statusCode, code, message, details) {
  sendJson(response, statusCode, {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
