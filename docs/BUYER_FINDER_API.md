# Buyer Finder Local API

Status: Milestone 4 complete

The Buyer Finder API is a local, unauthenticated MVP interface. Do not expose it publicly. Starting
a search requires `OPENROUTER_API_KEY`; history, status, results, and candidate reviews remain
available without the key.

All Buyer Finder errors use:

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Human-readable explanation."
  }
}
```

## Start a search

`POST /api/buyer-searches`

Accepts `BuyerSearchInput`. A valid request returns immediately with `202 Accepted`:

```json
{
  "id": "search-id",
  "status": "QUEUED"
}
```

The request does not remain open while agents run. Poll the status endpoint. Input validation caps
the requested result count at 25. The local worker runs one search at a time and queues at most
`BUYER_SEARCH_MAX_QUEUED` waiting searches, default 10.

## List searches

`GET /api/buyer-searches`

Returns compact history records newest first. Internal prompts, model configuration, and routing
metadata are intentionally omitted. Searches created after the pipeline diagnostics migration also
include a compact `summary` with researched, verified, saved, and rejected candidate counts. Older
searches return `null` for this field.

## Poll search status

`GET /api/buyer-searches/:id`

Returns validated input, lifecycle status, human-readable stage, progress, aggregate usage, safe
error information, and timestamps. Completed searches also expose a safe `outcome` object containing
the run summary and per-candidate qualification decisions. Decisions include the candidate name,
eligibility, confidence, missing mandatory evidence types, and rejection reasons. Searches completed
before this diagnostic data was introduced return `null` for `outcome`.

## Get results

`GET /api/buyer-searches/:id/results`

Returns ranked buyer matches with company information, confidence, review state, public business
contacts, and retained evidence. Every contact includes its public source URL. Internal normalized
names, database source IDs, prompts, and model settings are omitted.

## Cancel a search

`POST /api/buyer-searches/:id/cancel`

Cancellation is best effort. Queued work is removed; running model calls receive an abort signal.
Already completed upstream calls may remain chargeable. Cancelling a terminal search returns `409`.

## Review a candidate

`PATCH /api/buyer-matches/:id/review`

Body:

```json
{
  "status": "APPROVED"
}
```

Allowed values are `NEW`, `APPROVED`, and `REJECTED`.

## Status codes

- `200`: successful read, cancellation, or review.
- `202`: search accepted and queued.
- `400`: malformed JSON, invalid input, or invalid path encoding.
- `404`: unknown search, candidate, or route.
- `409`: invalid lifecycle operation.
- `413`: request body exceeds 64 KiB.
- `429`: local waiting queue is full.
- `500`: safe internal error.
- `503`: the OpenRouter-backed runtime is not configured.

Existing costing and load-plan endpoints keep their previous request and response contracts.
