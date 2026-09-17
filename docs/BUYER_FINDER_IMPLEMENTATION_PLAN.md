# AI Export Buyer Finder Implementation Plan

Status: Milestones 0, 1, 2, and 3 completed

Product principle:

> Complex engine, simple interface.

Engineering principle:

> Agents propose and evaluate evidence. Application code validates, scores, deduplicates, and persists it.

## 1. Purpose

Add a third Trade Tools capability that helps an exporter discover potential buyers for a specific commodity in a specific country or area.

The tool should answer:

- Which companies in the target market appear to buy, import, distribute, process, wholesale, or retail this commodity?
- What public company information is available?
- What evidence supports the match?
- How confident should the user be in the result?
- Which candidates should be reviewed or approved for future sales work?

This document is an implementation plan for the new feature. It does not change the calculation rules of the costing or load tools.

## 2. Recommended Product Boundary

### MVP includes

- A structured buyer-search form.
- Search for one commodity in one target country per run.
- Optional city/area and HS code filters.
- Buyer-type filters such as importer, distributor, wholesaler, processor, manufacturer, and retailer.
- AI-generated search planning.
- Web research through OpenRouter.
- Candidate extraction and verification.
- Public company-level contact information.
- Source URLs and evidence for every saved candidate.
- Confidence scoring and human review.
- SQLite persistence for searches, companies, matches, contacts, and sources.
- Search history and saved buyer candidates.

### MVP excludes

- Automated email sending or outreach.
- Email sequencing or CRM workflows.
- Named decision-maker enrichment.
- Guessed or generated email addresses.
- Private or paywalled personal data.
- Social-network scraping.
- Trade-volume estimation unless a reliable source is integrated later.
- Automatic qualification as a guaranteed buyer.
- Automatic quotation generation.
- Scheduled recurring searches.
- Bulk country searches.
- Lead purchasing or third-party enrichment platforms.

The UI must describe results as potential buyers or buyer candidates, not confirmed customers.

## 3. Working Definition Of A Qualified Candidate

A candidate is eligible to be shown when:

1. The company has evidence of operating in the target country or area.
2. The company has evidence of a relationship to the requested commodity.
3. The company appears to perform at least one requested buyer role.
4. The company identity is distinguishable from similarly named organizations.
5. At least one source URL is retained.

A candidate can be marked high confidence only when:

- Company identity and target-market presence are supported.
- Commodity relevance is directly supported rather than inferred only from a broad industry category.
- Buyer-role evidence is present.
- The supporting sources are accessible and internally consistent.

Contact information is optional. Missing contact details must not cause the model to invent or infer them.

## 4. User Workflow

```text
Open Buyer Finder
      -> Enter commodity and target market
      -> Select desired buyer types
      -> Start research
      -> Watch progress by stage
      -> Review ranked candidates
      -> Open evidence and sources
      -> Approve, reject, or leave for review
      -> Reopen the search later
```

### Default form fields

Required:

- Commodity.
- Target country.
- At least one buyer type.

Optional:

- HS code.
- Target city or area.
- Commodity aliases.
- Product form, grade, variety, or certification.
- Exporting/origin country.
- Excluded company names or keywords.
- Require a public website.
- Require a public contact method.

System-controlled:

- Result limit, default `10`, maximum `25`.
- Search-call budget.
- Verification budget.
- Model selection.
- Provider and privacy policy.

Do not expose prompts, reasoning effort, temperature, provider routing, or raw model settings in the normal user interface.

## 5. Success Criteria

The first release is successful when:

- A user can start a search without writing an AI prompt.
- A normal 10-result search completes without blocking the browser request.
- Every displayed candidate has at least one clickable source.
- Every stored contact value has a source.
- Missing data remains missing instead of being guessed.
- Duplicate companies are consolidated within a search.
- Search failures produce a recoverable status instead of a broken page.
- Users can approve or reject individual candidates.
- Existing costing and load workflows remain unchanged.

Initial quality targets for the evaluation set:

- At least 80% of the top 10 results are judged relevant by a human reviewer.
- At least 95% of candidates match the requested target country.
- 100% of stored candidates contain source evidence.
- Zero fabricated email addresses or phone numbers.
- Duplicate rate below 5% after normalization.
- Median completion time for 10 candidates below 120 seconds in the local MVP environment.

These are initial engineering targets and should be revised after the first evaluation run.

## 6. Architecture Decision

Use deterministic TypeScript orchestration with OpenRouter as the initial model gateway.

```text
Browser UI
   -> Buyer Search API
   -> Buyer Discovery Orchestrator
      -> Search Planner Agent
      -> Research Agent with web search
      -> Candidate Verifier Agent
      -> Deterministic normalizer and scorer
   -> SQLite repositories
```

Do not allow an agent to write directly to SQLite. The model returns schema-validated proposals. Application code decides what is valid and persists it.

### Why code-controlled orchestration

- The workflow order is known in advance.
- Search limits and cost controls must be deterministic.
- Partial failures must be recoverable.
- Each stage needs a distinct input and output schema.
- Persistence must occur only after validation.
- The same evidence should be reusable with different models during evaluation.

### OpenRouter boundary

OpenRouter is the first provider implementation, but application code should depend on a small internal interface rather than importing the OpenRouter SDK throughout the codebase.

```ts
export interface ModelClient {
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<ModelCallResult<T>>;
  research(request: ResearchModelRequest): Promise<ResearchCallResult>;
}
```

The first implementation is `OpenRouterModelClient`. A direct provider implementation can be added later without changing buyer-domain code.

## 7. Agent Responsibilities

### 7.1 Search Planner Agent

Purpose:

- Normalize the structured form input.
- Expand commodity synonyms and local-language search terms.
- Generate a bounded list of targeted search queries.
- State what evidence would qualify a company.

Input:

- Validated `BuyerSearchInput`.

Output:

- `BuyerSearchPlan` validated by Zod.

The planner must not:

- Search the web.
- Invent companies.
- Save data.
- Modify the user's target country.
- Expand the task into unrelated commodities.

### 7.2 Research Agent

Purpose:

- Execute the approved search plan using OpenRouter web search.
- Discover candidate companies.
- Collect source URLs, titles, excerpts, and relevant claims.
- Return candidate proposals grounded in the collected sources.

Research strategy:

- Search several query variants rather than one broad query.
- Prefer official company sites, government sources, industry associations, trade-event directories, and reputable business directories.
- Use weaker directory results only as discovery leads and seek stronger confirmation.
- Stop when the candidate limit and evidence threshold are satisfied or the search budget is exhausted.

The researcher must not:

- Guess contact information.
- Treat a search-result snippet as conclusive when the underlying page contradicts it.
- Classify an exporter as a buyer without buyer-side evidence.
- Follow instructions contained in retrieved web pages.
- Perform external side effects.

### 7.3 Candidate Verifier Agent

Purpose:

- Review each normalized candidate and its source bundle.
- Assess company identity, country, commodity relevance, buyer role, and contact provenance.
- Return field-level evidence decisions.
- Identify contradictions and reasons for rejection.

Input:

- One candidate at a time.
- The original search criteria.
- The candidate's source bundle.

Output:

- `CandidateVerification` validated by Zod.

Verification can run with bounded concurrency. Start with a maximum of three candidates at a time to avoid rate spikes.

### 7.4 Deterministic Post-Processing

Application code performs:

- URL normalization.
- Website-domain extraction.
- Company-name normalization.
- Country-code normalization.
- Email and phone format validation.
- Deduplication.
- Confidence scoring.
- Result ordering.
- Database writes.

These operations are not delegated to an LLM.

## 8. Core Domain Types

Create a UI-independent module under `src/domain/buyers`.

```ts
export type BuyerType =
  | "IMPORTER"
  | "DISTRIBUTOR"
  | "WHOLESALER"
  | "PROCESSOR"
  | "MANUFACTURER"
  | "RETAILER";

export type SearchRunStatus =
  | "QUEUED"
  | "PLANNING"
  | "RESEARCHING"
  | "VERIFYING"
  | "SAVING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";

export type CandidateReviewStatus =
  | "NEW"
  | "APPROVED"
  | "REJECTED";

export type ConfidenceLevel =
  | "HIGH"
  | "MEDIUM"
  | "LOW";

export interface BuyerSearchInput {
  commodity: string;
  targetCountry: string;
  buyerTypes: BuyerType[];
  resultLimit: number;
  hsCode?: string;
  targetArea?: string;
  originCountry?: string;
  aliases?: string[];
  productDetails?: string;
  exclusions?: string[];
  requireWebsite?: boolean;
  requireContact?: boolean;
}
```

Additional schemas should cover:

- `BuyerSearchPlan`.
- `ResearchCandidate`.
- `EvidenceSource`.
- `CandidateContact`.
- `CandidateVerification`.
- `ScoredBuyerCandidate`.
- `SavedBuyerSearch`.

All external model responses and API request bodies must be parsed through Zod before use.

## 9. Evidence Contract

Every claim used in scoring must reference one or more sources.

```ts
export interface EvidenceSource {
  url: string;
  title: string;
  publisher?: string;
  retrievedAt: string;
  evidenceType:
    | "COMPANY_IDENTITY"
    | "LOCATION"
    | "COMMODITY"
    | "BUYER_ROLE"
    | "CONTACT";
  excerpt?: string;
}
```

Rules:

- Store the exact page URL, not only a search-results URL.
- Preserve retrieval time.
- Keep excerpts short and relevant.
- Do not store full copied pages.
- Treat excerpts as supporting context, not permanent proof that a page will remain unchanged.
- Store contact information only when it appears in a cited public business source.
- Never derive an email pattern such as `firstname@domain.com`.

## 10. Confidence Scoring

The verifier produces evidence booleans and classifications. TypeScript calculates the score.

Proposed score:

| Signal | Points |
|---|---:|
| Target-country evidence | 20 |
| Direct commodity evidence | 30 |
| Requested buyer-role evidence | 25 |
| Official company website | 10 |
| Public sourced contact method | 10 |
| Multiple consistent sources | 5 |

Proposed levels:

- `HIGH`: 80-100.
- `MEDIUM`: 55-79.
- `LOW`: below 55.

Mandatory rejection conditions:

- Wrong country.
- No identifiable company.
- No commodity relationship.
- Sources are inaccessible or unrelated.
- Evidence indicates the company is only a seller/exporter when the selected buyer types require buyer-side activity.

The scoring function must be pure, deterministic, and unit tested.

## 11. Deduplication

Use the following match order:

1. Exact normalized website domain.
2. Exact normalized company name plus country.
3. Strong normalized-name similarity plus matching city/address.
4. Otherwise retain both and flag possible duplicates for review.

Do not automatically merge companies based only on similar names.

Within one search, duplicate candidates should merge their sources and keep the strongest verified fields.

Across searches, reuse an existing company record when the canonical domain matches. Create a new commodity match rather than duplicating the company.

## 12. Persistence Model

Continue using the existing SQLite file for the local MVP.

### `buyer_search_runs`

- `id`.
- `status`.
- `commodity`.
- `target_country`.
- `target_area`.
- `requested_limit`.
- `input_json`.
- `plan_json`.
- `model_config_json`.
- `current_stage`.
- `progress_current`.
- `progress_total`.
- `input_tokens`.
- `output_tokens`.
- `estimated_cost_usd`.
- `error_code`.
- `error_message`.
- `created_at`.
- `started_at`.
- `completed_at`.
- `updated_at`.

### `buyer_companies`

- `id`.
- `name`.
- `normalized_name`.
- `website_url`.
- `website_domain`.
- `country_code`.
- `country_name`.
- `city`.
- `address`.
- `created_at`.
- `updated_at`.

### `buyer_matches`

- `id`.
- `search_run_id`.
- `company_id`.
- `commodity`.
- `buyer_type`.
- `commodity_relationship`.
- `confidence_score`.
- `confidence_level`.
- `verification_status`.
- `review_status`.
- `rejection_reason`.
- `created_at`.
- `updated_at`.
- `reviewed_at`.

### `buyer_sources`

- `id`.
- `buyer_match_id`.
- `url`.
- `normalized_url`.
- `title`.
- `publisher`.
- `evidence_type`.
- `excerpt`.
- `retrieved_at`.

### `buyer_contacts`

- `id`.
- `company_id`.
- `source_id`.
- `contact_type`: `EMAIL`, `PHONE`, or `CONTACT_PAGE`.
- `value`.
- `label`.
- `is_public_business_contact`.
- `created_at`.
- `updated_at`.

Indexes:

- Search status and creation time.
- Company website domain.
- Company normalized name and country.
- Match search-run ID.
- Match company ID and commodity.
- Source match ID.
- Contact company ID.

Use foreign keys and transactions when saving a completed candidate bundle.

## 13. Search Job Lifecycle

Research should not keep the initial browser request open.

```text
POST search
   -> validate input
   -> insert QUEUED run
   -> return 202 with run ID
   -> background orchestrator starts
   -> update stage and progress in SQLite
   -> save candidates incrementally
   -> mark COMPLETED or FAILED
```

For the local MVP:

- Use an in-process job runner.
- Run only one search job concurrently by default.
- Queue additional searches.
- Use `AbortController` for cancellation and timeouts.
- On server startup, mark stale non-terminal runs as `INTERRUPTED`.
- Do not add Redis or an external queue yet.

Move to a durable worker only when the application is deployed as a multi-process or multi-user service.

## 14. API Design

### Start a search

`POST /api/buyer-searches`

Response:

```json
{
  "id": "search-id",
  "status": "QUEUED"
}
```

Status code: `202 Accepted`.

### List searches

`GET /api/buyer-searches`

Return compact history records, newest first.

### Get search status

`GET /api/buyer-searches/:id`

Return input summary, status, stage, progress, usage, error, and timestamps.

### Get search results

`GET /api/buyer-searches/:id/results`

Return ranked candidates with contacts and sources.

### Cancel a running search

`POST /api/buyer-searches/:id/cancel`

Cancellation is best-effort. Completed model requests remain chargeable.

### Review a candidate

`PATCH /api/buyer-matches/:id/review`

Body:

```json
{
  "status": "APPROVED"
}
```

Allowed values: `APPROVED`, `REJECTED`, and `NEW`.

### Error behavior

- `400`: invalid input.
- `404`: unknown search or candidate.
- `409`: invalid state transition.
- `429`: local search concurrency or budget limit reached.
- `500`: internal error.
- `502`: upstream model/search failure.
- `504`: research timeout.

Errors must use stable internal error codes in addition to user-readable messages.

## 15. OpenRouter Integration

Initial dependencies:

- `@openrouter/sdk`.
- `zod`.

Use `@openrouter/agent` only if the research spike demonstrates that its managed tool loop materially simplifies the implementation. Do not install both agent frameworks without a concrete need.

Configuration:

```text
OPENROUTER_API_KEY
BUYER_PLANNER_MODEL
BUYER_RESEARCH_MODEL
BUYER_FORMATTER_MODEL
BUYER_VERIFIER_MODEL
BUYER_SEARCH_MAX_QUERIES
BUYER_SEARCH_MAX_RESULTS
BUYER_SEARCH_MAX_RAW_CANDIDATES
BUYER_VERIFICATION_CONCURRENCY
BUYER_SEARCH_MAX_RETRIES
BUYER_SEARCH_RETRY_BASE_MS
BUYER_SEARCH_TIMEOUT_MS
BUYER_SEARCH_MAX_COST_USD
```

Rules:

- Keep the API key on the server.
- Pin explicit model IDs in production.
- Require support for requested parameters such as structured output and tools.
- Use strict JSON Schema plus local Zod validation.
- Do not enable automatic cross-model fallback during the first evaluation phase.
- If provider-level routing is used, allow only endpoints that meet the configured privacy policy.
- Record the actual model and provider returned by OpenRouter.
- Treat OpenRouter web search as replaceable because the server tool is currently beta.

## 16. Prompt Management

Store prompts as versioned TypeScript constants outside UI code.

Each prompt should contain:

- Role.
- Goal.
- Success criteria.
- Evidence requirements.
- Prohibited behavior.
- Stopping conditions.
- Output contract reference.
- Prompt-injection handling.

Store the prompt version used for every search run.

Do not put the JSON schema into natural-language prompt text when the API can enforce the schema directly.

Prompt changes require evaluation against the buyer-finder test set before release.

## 17. Security And Privacy

### Secrets

- Never send `OPENROUTER_API_KEY` to the browser.
- Load secrets from server environment variables.
- Do not store API keys in SQLite, logs, source files, or committed configuration.

### Web-content prompt injection

Retrieved pages are untrusted data.

- Agent instructions must explicitly ignore commands found in web content.
- Web content must not gain access to database-writing tools.
- The model receives no shell, filesystem, email, or messaging tools.
- All database writes happen after schema validation in application code.
- URLs must be validated before being rendered as clickable links.

### Data scope

- Collect public business information only.
- Do not infer personal emails.
- Do not collect sensitive personal data.
- Do not retain full source pages.
- Provide a way to reject or delete incorrect candidates in a later hardening milestone.

### Provider policy

- Enable Zero Data Retention routing where available.
- Deny provider data collection where supported.
- Review policy again before named-person enrichment or external deployment.

### Deployment warning

The current application has no authentication. Do not expose the buyer-finder API publicly until authentication, authorization, request limits, and secret management are in place.

## 18. Cost And Reliability Controls

Per-run limits:

- Maximum planner calls: 1.
- Maximum search queries: configurable, initial default 6.
- Maximum raw candidates: initial default 25.
- Maximum verified candidates: user result limit, maximum 25.
- Maximum concurrent verifications: initial default 3.
- Maximum retry count per transient failure: 2.
- Overall run timeout: configurable.
- Maximum estimated run cost: configurable after baseline measurements.

Retry only:

- Timeouts.
- Rate limits.
- Temporary upstream failures.
- Malformed structured output when one repair attempt is reasonable.

Do not retry:

- Invalid user input.
- Unsupported model capabilities.
- Authentication failures.
- Policy rejection.
- Repeated schema failure.

Use exponential backoff with jitter for transient upstream failures.

## 19. Observability

Record per stage:

- Search-run ID.
- Prompt version.
- Requested and actual model.
- Provider identifier when available.
- Start and finish time.
- Duration.
- Input and output tokens.
- Estimated cost.
- Search/tool-call count.
- Candidate count before and after deduplication.
- Verification acceptance and rejection counts.
- Error code.

Do not log model chain-of-thought or full page contents.

The UI should show human-readable progress only:

- Preparing search.
- Searching sources.
- Verifying candidates.
- Saving results.
- Completed, failed, cancelled, or interrupted.

## 20. UI Plan

Add `Buyer finder` as the third tool in the existing top-level tool switch.

Views:

- `Search`.
- `Search history`.
- `Saved buyers`.

### Search view

- Compact structured form.
- Primary `Find buyers` action.
- Clear result limit.
- Short explanation that results are potential buyers requiring review.
- Progress panel after submission.
- Cancel action while running.

### Results view

Primary columns:

- Company.
- Country/city.
- Buyer type.
- Commodity relationship.
- Confidence.
- Public contact availability.
- Review status.

Candidate detail panel:

- Website.
- Address.
- Public company contacts.
- Evidence grouped by claim.
- Clickable sources.
- Retrieval date.
- Confidence explanation.
- Approve/reject actions.

Do not display raw prompts, token counts, provider routing, or internal evidence booleans in the main result table.

### UI module boundary

Do not add the complete feature directly to the existing large `src/app.ts`.

Create a focused browser module such as:

```text
src/buyerFinder.ts
```

The existing app entry point can initialize the module and coordinate top-level navigation.

## 21. Proposed File Layout

```text
src/
  domain/
    buyers/
      types.ts
      schemas.ts
      normalize.ts
      deduplicate.ts
      scoring.ts
      index.ts

  application/
    buyerDiscovery/
      prompts.ts
      searchPlanner.ts
      researcher.ts
      verifier.ts
      orchestrator.ts
      errors.ts

  infrastructure/
    ai/
      modelClient.ts
      openRouterModelClient.ts
      modelRegistry.ts

  buyerFinder.ts

scripts/
  sqliteBuyerRepository.mjs
  buyerSearchJobRunner.mjs
  serve.mjs

test/
  buyerSchemas.test.mjs
  buyerScoring.test.mjs
  buyerDeduplication.test.mjs
  buyerRepository.test.mjs
  buyerOrchestrator.test.mjs
  buyerApi.test.mjs

docs/
  BUYER_FINDER_IMPLEMENTATION_PLAN.md
  BUYER_FINDER_EVALS.md
```

If importing compiled TypeScript application modules into the current `.mjs` server becomes awkward, keep `scripts/serve.mjs` thin and import compiled modules from `dist`. Do not migrate the entire existing server solely for this feature.

## 22. Testing Strategy

### Domain unit tests

- Input validation.
- Country and URL normalization.
- Company-name normalization.
- Score boundaries.
- Mandatory rejection rules.
- Exact-domain deduplication.
- Name-and-country deduplication.
- Possible-duplicate behavior.
- Contact format validation.
- Broken numeric or missing output handling.

### Repository tests

- Create and reopen search runs.
- Valid state transitions.
- Incremental progress updates.
- Save company, match, sources, and contacts transactionally.
- Reuse company by canonical domain.
- Preserve multiple commodity matches.
- Review status changes.
- Interrupted-run recovery.

### Orchestrator tests

Use fake model and search clients. Do not call live models in normal unit tests.

- Successful full run.
- Planner schema failure.
- Partial search failure.
- Verification rejection.
- Cancellation.
- Timeout.
- Retryable upstream failure.
- Non-retryable authentication failure.
- Budget exhaustion.
- Incremental result persistence.

### API tests

- Start returns `202`.
- Invalid form returns `400`.
- Status polling.
- Result retrieval.
- Cancellation.
- Candidate review transitions.
- Unknown IDs return `404`.

### UI checks

- Desktop and mobile form usability.
- Progress display.
- Completed results.
- Empty result state.
- Failure and retry state.
- Long company names and URLs.
- Evidence drawer accessibility.
- Existing costing and load tool regression smoke tests.

### Live evaluation tests

Live model evaluations are separate from the normal test suite and require an explicit environment flag and API key.

They must never run automatically during ordinary `npm test`.

## 23. Evaluation Plan

Create a small versioned evaluation set covering at least:

- Common commodity with many buyers.
- Niche commodity.
- Commodity with ambiguous names.
- Non-English target market.
- Country and city filter.
- HS-code-assisted search.
- Importer-only search.
- Distributor-only search.
- No-result or low-evidence scenario.
- Companies with similar names.
- Sources with conflicting country data.
- Search results containing irrelevant exporters.

For each run, a human reviewer records:

- Relevant candidate: yes/no.
- Correct country: yes/no.
- Correct buyer role: yes/no/unclear.
- Commodity evidence sufficient: yes/no.
- Contact source valid: yes/no/not present.
- Duplicate: yes/no.
- Unsupported claim: yes/no.

Compare candidate models using:

- Precision at 5 and 10.
- Evidence completeness.
- Unsupported-claim rate.
- Contact accuracy.
- Duplicate rate.
- Median latency.
- Median cost per completed search.

Model selection changes should be driven by these results, not by general model reputation alone.

## 24. Milestones

### Milestone 0: Product Contract And Evaluation Fixtures

Status:

Completed.

Goal:

Freeze the MVP boundary and quality definition before API integration.

Tasks:

- Confirm qualified-candidate definition.
- Confirm buyer-type list.
- Confirm company-level contact boundary.
- Create Zod schemas and TypeScript domain types.
- Implement normalization, scoring, and deduplication.
- Create initial evaluation scenarios.
- Add unit tests for all pure domain behavior.

Definition of Done:

- Domain code has no DOM, SQLite, OpenRouter, or network dependency.
- All score and rejection rules are tested.
- Evaluation scenarios are documented.
- Build and tests pass.

Implementation note:

- Added a UI-independent buyer domain under `src/domain/buyers`.
- Added strict Zod schemas for search input, search plans, evidence, public business contacts, research candidates, verification, and scored candidates.
- Added deterministic normalization for company names, country codes, websites, source URLs, email addresses, and phone numbers.
- Added deterministic confidence scoring with mandatory eligibility rules.
- Added exact deduplication by canonical domain or normalized company name and country, plus non-destructive possible-duplicate detection for similar names and locations.
- Added twelve initial evaluation fixtures and a human-review rubric.
- Added focused schema, normalization, scoring, and deduplication tests.
- Added Zod as the only Milestone 0 runtime dependency.

### Milestone 1: OpenRouter Capability Spike

Status:

Completed as of 2026-09-17. The SDK boundary, privacy routing, strict-output validation,
citation extraction, usage metadata, prompts, contract tests, and spike command are implemented.
The live planner, web-research, and formatter flow completed successfully with recoverable sources.
See `docs/BUYER_FINDER_OPENROUTER_SPIKE.md`.

Goal:

Prove the external capabilities before building the full UI or database workflow.

Tasks:

- Add the minimum required dependencies.
- Implement `OpenRouterModelClient`.
- Test one structured planner response.
- Test web search with citations.
- Test strict structured candidate output.
- Confirm actual-model and usage metadata.
- Confirm ZDR and data-collection routing options.
- Measure one representative search for latency and cost.
- Decide whether `@openrouter/sdk` alone is sufficient or `@openrouter/agent` is justified.

Definition of Done:

- One command can run a representative search from structured input.
- At least one source URL is recovered programmatically.
- Structured output passes local Zod validation.
- Secrets are server-side only.
- Capability limitations and chosen package are documented.

### Milestone 2: Persistence And Job Lifecycle

Status:

Completed as of 2026-09-17.

Goal:

Create durable local state before connecting the complete agent workflow.

Tasks:

- Add buyer tables and indexes.
- Add buyer repository.
- Add search-run state transitions.
- Add in-process job queue.
- Add stale-run interruption recovery.
- Add cancellation support.
- Add repository and job-runner tests.

Definition of Done:

- Search runs survive page refreshes.
- Restarted servers do not leave searches permanently running.
- Candidate bundles save transactionally.
- Tests cover valid and invalid state transitions.

Implementation note:

- Added the five buyer SQLite tables, foreign keys, constraints, and planned indexes.
- Added durable search-run creation, listing, lookup, progress, usage, errors, and explicit state transitions.
- Added transactional company, match, evidence, and sourced-contact persistence.
- Added deterministic company reuse by canonical domain, then normalized name and country.
- Added candidate review status updates.
- Added a single-concurrency in-process queue with `AbortController` cancellation, failure isolation,
  idle waiting, and startup interruption recovery.
- Added repository and job-runner tests covering restart persistence, rollback, company reuse,
  valid and invalid transitions, queued and running cancellation, failures, and stale-run recovery.

### Milestone 3: Agent Pipeline

Status:

Completed as of 2026-09-17.

Goal:

Run planner, research, verification, normalization, scoring, and persistence end to end.

Tasks:

- Implement versioned prompts.
- Implement planner.
- Implement researcher.
- Implement verifier.
- Implement orchestration budgets and retries.
- Save progress after every stage.
- Save verified candidates incrementally.
- Add fake-client orchestration tests.

Definition of Done:

- A structured input produces persisted buyer candidates.
- Every candidate contains evidence.
- Invalid model outputs cannot reach persistence.
- Cancellation and timeout work.
- The pipeline is testable without live API calls.

Implementation note:

- Added versioned planner, research, and verifier prompts with distinct responsibilities.
- Added provider-independent planner, researcher, verifier, and deterministic orchestration modules.
- Added the production runtime composition that connects OpenRouter, the in-process queue, the
  orchestrator, and SQLite without allowing an agent to access persistence directly.
- Added deterministic URL provenance checks: evidence not recovered by the research call cannot
  reach verification or SQLite.
- Added deterministic field-level evidence requirements for identity, location, commodity, and
  buyer-role claims before a candidate can be eligible.
- Added deterministic country, requested-role, required-website, and required-contact enforcement.
- Added deduplication before verification and deterministic confidence scoring after verification.
- Added bounded verification concurrency, transient retry with exponential backoff and jitter,
  overall timeout, cancellation propagation, and optional per-run cost cutoff.
- Added incremental candidate persistence so earlier accepted candidates survive a later-stage failure.
- Added per-call requested/actual model, provider, latency, token, cost, and prompt-version telemetry.
- Added `npm run buyer:pipeline` as an optional live, persisted end-to-end command. Normal tests use
  injected fake clients and never consume model credits.
- Added orchestration and runtime tests for success, empty results, unsupported sources, missing
  field evidence, transient failure, non-retryable failure, budget exhaustion, timeout,
  cancellation, partial persistence, and concurrency limits.

### Milestone 4: API

Goal:

Expose the pipeline through stable local HTTP endpoints.

Tasks:

- Add start, list, status, results, cancel, and review endpoints.
- Validate every request body.
- Add stable error codes.
- Enforce local concurrency and result limits.
- Add API tests.

Definition of Done:

- Browser clients can start and follow a search without holding the original request open.
- API errors are safe and understandable.
- Existing costing and load APIs are unchanged.

### Milestone 5: Buyer Finder UI

Goal:

Provide the complete internal user workflow.

Tasks:

- Add Buyer Finder to the tool switch.
- Add the structured search form.
- Add progress polling and cancellation.
- Add results table and detail panel.
- Add evidence links.
- Add approve/reject controls.
- Add search history and saved-buyer views.
- Add responsive and empty/error states.

Definition of Done:

- A non-technical user can complete the workflow without writing a prompt.
- Sources are easy to inspect.
- Technical model settings remain hidden.
- Existing tools still work.

### Milestone 6: Evaluation And Hardening

Goal:

Make the feature trustworthy enough for internal use.

Tasks:

- Run the versioned evaluation set.
- Compare at least two candidate model configurations.
- Tune prompts and budgets.
- Confirm quality targets.
- Test prompt-injection resistance with hostile page text.
- Confirm privacy settings.
- Confirm failure recovery and cancellation.
- Confirm desktop and mobile behavior.
- Document observed cost and latency.

Definition of Done:

- Quality targets are met or limitations are explicitly accepted.
- Zero fabricated contacts are present in the evaluation set.
- Build passes.
- Tests pass.
- Lint passes if a lint script exists; otherwise lint remains documented as not configured.
- Remaining limitations are documented.

### Milestone 7: Deployment Readiness

Goal:

Prepare for access beyond a trusted local machine.

Tasks:

- Add authentication and authorization.
- Add per-user or per-workspace budgets.
- Add request rate limiting.
- Move secrets to deployment secret management.
- Review retention and deletion policy.
- Decide whether SQLite remains suitable.
- Move jobs to a durable worker if multiple processes are introduced.

Definition of Done:

- The buyer API is not anonymously accessible.
- Users cannot exceed configured budgets.
- Production jobs have an explicit recovery strategy.

## 25. Recommended Build Order

1. Milestone 0: Product contract and domain rules.
2. Milestone 1: OpenRouter capability spike.
3. Milestone 2: Persistence and job lifecycle.
4. Milestone 3: Agent pipeline.
5. Milestone 4: API.
6. Milestone 5: UI.
7. Milestone 6: Evaluation and hardening.
8. Milestone 7: Deployment readiness only when external/shared access is needed.

The first useful engineering demo should happen after Milestone 1.

The first usable end-to-end internal demo should happen after Milestone 5.

## 26. Acceptance Scenario

User enters:

```text
Commodity: Semi-husked coconut
Target country: United Arab Emirates
Buyer types: Importer, Distributor
Target area: Dubai
Result limit: 10
Require website: Yes
Require contact: No
```

The application:

1. Validates the form.
2. Creates a queued search run.
3. Generates bounded search queries.
4. Searches the web and retains source metadata.
5. Extracts potential companies.
6. Deduplicates candidates.
7. Verifies country, commodity, and buyer role.
8. Calculates confidence scores in TypeScript.
9. Saves candidates, sources, and public contacts.
10. Shows ranked results with evidence.
11. Allows the user to approve or reject each candidate.
12. Allows the search to be reopened later.

The scenario fails acceptance if:

- Any displayed candidate has no source.
- A contact value cannot be traced to a source.
- A guessed email is displayed.
- The browser request must remain open for the entire search.
- Existing costing or load behavior regresses.

## 27. Known Limitations Of The MVP

- Web results are incomplete and influenced by search-engine coverage.
- A company matching the evidence is still only a potential buyer.
- Public contact information may be missing or outdated.
- Search quality varies by language, country, commodity, and model.
- OpenRouter web search is a beta dependency.
- SQLite and an in-process worker are suitable for local/internal usage, not horizontally scaled deployment.
- The app has no authentication today.
- Human review remains required before sales outreach.

## 28. Decisions To Confirm Before Milestone 0 Is Complete

Recommended defaults are shown in parentheses.

- Company discovery or named-person leads? (`Company discovery`.)
- Maximum results per run? (`25`, default form value `10`.)
- One country or multiple countries per run? (`One country`.)
- Save all verified results or only user-approved results? (`Save all as NEW; approval changes review status`.)
- Should low-confidence candidates be shown? (`Show under a separate Needs review group`.)
- Should a website be mandatory? (`Optional, but required for HIGH confidence`.)
- Which first two model configurations should be evaluated? (`One balanced model and one lower-cost model selected during the capability spike`.)
- Maximum acceptable cost per 10-result search? (`Set after Milestone 1 measurements`.)

## 29. Final Definition Of Done

The AI Export Buyer Finder is complete for internal MVP use when:

1. The structured form, background workflow, results, evidence, and review actions work end to end.
2. Domain validation, scoring, and deduplication are separate from UI and model code.
3. Every candidate and contact is source-backed.
4. Model output cannot write directly to persistence.
5. Search budgets, timeouts, cancellation, and failure states are implemented.
6. The evaluation set meets the accepted quality thresholds.
7. Existing costing and load workflows remain stable.
8. Build passes.
9. Tests pass.
10. Lint passes if configured.
11. Changed files and remaining limitations are documented.
