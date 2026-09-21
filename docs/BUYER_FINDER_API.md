# Buyer Finder Local API

Status: Milestone 4 complete; authenticated Supabase deployment and controlled fallback implemented

The Buyer Finder API is served by the Node application and every `/api/*` endpoint requires a valid
Supabase access token. Starting a search also requires `OPENROUTER_API_KEY` on the server. Database
credentials and the OpenRouter key are never sent to the browser.

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

When the strict pass returns fewer than `BUYER_FALLBACK_MIN_QUALIFIED` qualified candidates, the
runtime can perform one bounded evidence-recovery pass. It preserves the original country, area,
buyer roles, exclusions, website/contact requirements, cost ceiling, and timeout. Configure it with:

```text
BUYER_FALLBACK_ENABLED=true
BUYER_FALLBACK_MIN_QUALIFIED=3
BUYER_FALLBACK_MAX_SEARCH_CALLS=2
BUYER_FALLBACK_MAX_CANDIDATES=10
```

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

Every status response also includes an append-only `events` timeline. It records safe lifecycle,
progress, model-call, fallback, cancellation, and failure events. Event details never include
credentials, raw prompts, raw model output, or unredacted contact values.

When the strict result threshold was missed, `outcome.fallback` reports whether supplemental research
ran, how many candidates were repaired and reverified, how many qualified candidates were recovered,
and whether strict results were retained after a non-fatal supplemental failure.

## Get results

`GET /api/buyer-searches/:id/results`

Returns ranked buyer matches with company information, confidence, review state, public business
contacts, and retained evidence. Every contact includes its public source URL. Internal normalized
names, database source IDs, prompts, and model settings are omitted.

## Cancel a search

`POST /api/buyer-searches/:id/cancel`

Cancellation is best effort. Queued work is removed; running model calls receive an abort signal.
Already completed upstream calls may remain chargeable. Cancelling a terminal search returns `409`.

## Delete a terminal search

`DELETE /api/buyer-searches/:id`

Permanently removes a completed, failed, cancelled, or interrupted search from history. Its matches,
evidence, contacts, and pipeline events are removed through the database relationships. A company record
is removed only when no other search still references it. Active searches must be cancelled first and
return `409`.

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
