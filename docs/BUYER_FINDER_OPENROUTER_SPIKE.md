# Buyer Finder OpenRouter Capability Spike

Status: Complete; live provider validation succeeded

Date: 2026-09-17

## Purpose

Milestone 1 proves the model-gateway capabilities needed by Buyer Finder before the database,
job runner, API, or UI is built. It covers structured planning, bounded web research, source URL
recovery, local schema validation, privacy routing, and usage telemetry.

## Implemented Boundary

`OpenRouterModelClient` is the only module that imports the OpenRouter SDK. Buyer-domain and
future orchestration code depend on the internal `ModelClient` interface instead.

Both supported operations:

- Pin one explicit model ID.
- Request strict JSON Schema output generated from the local Zod schema.
- Parse the returned JSON through that same Zod schema before returning data.
- Set `store: false`.
- Require provider support for requested parameters.
- Deny provider data collection.
- Restrict routing to Zero Data Retention endpoints.
- Disable provider fallback for predictable early evaluation.
- Request OpenRouter routing metadata.
- Record requested model, actual model, selected provider, request ID, latency, token usage,
  inference cost, and server-tool cost when returned.

The research operation uses two provider-portable calls. The first enables `openrouter:web_search`
with the Exa engine, applies explicit search-call and result limits, and recovers URLs from both
citation annotations and web-search tool output. The second call has no tools and converts only the
captured research text and sources into strict structured output. Usage and latency are retained for
both steps and aggregated for the research operation.

## One-Command Spike

Copy the committed template once, add the key to the local Git-ignored file, then run:

```powershell
Copy-Item .env.example .env
# Edit .env and set OPENROUTER_API_KEY without committing the file.
npm run buyer:spike
```

Both `npm run buyer:spike` and `npm run dev` automatically load `.env` when it exists. A shell
environment variable takes precedence over the value in the file.

Optional configuration:

```text
BUYER_PLANNER_MODEL
BUYER_RESEARCH_MODEL
BUYER_SEARCH_MAX_QUERIES
BUYER_SEARCH_MAX_RESULTS
BUYER_SEARCH_TIMEOUT_MS
BUYER_SPIKE_COMMODITY
BUYER_SPIKE_COUNTRY
BUYER_SPIKE_AREA
```

If model variables are omitted, the spike uses `google/gemini-3.5-flash-lite` for planning and
`openai/gpt-4.1-mini` for web research and evidence formatting.
The role-specific split avoids a
Google provider limitation observed with web-search tool requests while keeping both models
explicitly pinned. Production configuration should pin model IDs after evaluation.

The command runs the acceptance-scenario shape: semi-husked coconut, United Arab Emirates,
Dubai, and importer/distributor roles. It fails if the API key is missing, model output violates
the local schemas, or no source URL can be recovered. Successful output includes the validated
plan, validated candidates, recovered sources, and per-call telemetry.

For inspection, the command prints a labeled result after each agent stage: the validated planner
plan, raw research synthesis with recovered sources, and validated formatter candidates. Research
output is printed before formatting begins, so provider failures do not hide already collected evidence.

## Automated Evidence

The OpenRouter contract tests use an injected fake transport, so they do not consume credits.
They verify:

- Strict schema and privacy controls are sent.
- Invalid structured output is rejected locally.
- Provider-facing schemas omit unsupported constraint keywords while the full Zod contract remains
  enforced after generation.
- Provider-facing string `format` hints are omitted because endpoint support differs (for example,
  Azure rejects `uri`); URL and datetime formats remain enforced by local Zod validation.
- Optional object properties are represented as required nullable fields for strict-provider
  compatibility, normalized back to omitted properties, and then validated with the original Zod schema.
- Web search is bounded.
- Search/tool execution is separated from schema-constrained formatting for provider portability.
- Citation and tool-result URLs are deduplicated and recovered.
- Actual model, provider, usage, cost, and generation timing are captured.
- A production client cannot be created without an API key.

## Package Decision

Use `@openrouter/sdk` alone for the MVP. The Responses API already supplies the server-side web
search loop, structured output, source annotations, usage, and routing metadata required by this
workflow. Adding `@openrouter/agent` now would duplicate orchestration responsibility and add a
second abstraction without a demonstrated capability benefit. Revisit this only if the Milestone
3 workflow requires a genuinely dynamic tool loop that deterministic TypeScript orchestration
cannot express cleanly.

## Live Validation

The representative command completed successfully against the live service on 2026-09-17. The
planner response passed local validation, web research returned recoverable source URLs, and the
formatting response passed the buyer-candidate schema. The command also emitted per-call model,
provider, latency, token, and cost telemetry as designed.

The exact telemetry snapshot was not copied into this document. Capture comparable measurements
as part of Milestone 6 model evaluation rather than treating a single spike run as a performance
baseline. Do not copy the API key into this document or any repository file.

### Measurement record

Live capability run succeeded; exact telemetry snapshot not retained.

## Known Capability Risks

- OpenRouter web search is a beta server tool and its response details can change.
- ZDR and parameter requirements can reduce the set of available provider endpoints.
- Not every model supports strict structured output equally well.
- Providers support different JSON Schema subsets. The gateway sends a portable structural schema;
  detailed string and literal constraints remain enforced by local Zod validation.
- A model's existence on OpenRouter does not guarantee that its active endpoints satisfy strict
  output, tools, and ZDR simultaneously; incompatible routing now produces an actionable error.
- Source annotations may omit titles; tool-only URLs are retained with the URL as a fallback title.
- Cost enforcement is not implemented in this spike; Milestone 3 needs a measured baseline first.
- Search results establish potential-buyer evidence, not a guaranteed commercial relationship.
