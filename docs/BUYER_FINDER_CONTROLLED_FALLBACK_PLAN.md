# Buyer Finder Controlled Fallback And Supabase-Only Plan

Status: core strict fallback implemented as of 2026-09-20. Live evaluation and the optional Research
Leads phase remain pending.

Related plan: `docs/BUYER_FINDER_IMPLEMENTATION_PLAN.md`

## 1. Decisions

This enhancement adopts the following decisions:

1. The current strict definition of a qualified buyer remains unchanged.
2. The automatic fallback is an evidence-recovery pass, not a lower qualification threshold.
3. The fallback can run at most once per search and must remain inside the original timeout, cost,
   country, buyer-role, exclusion, website, and contact constraints.
4. Qualified candidates and incomplete research leads are separate product concepts.
5. Research Leads are a second delivery phase behind a feature flag and do not count as qualified
   results.
6. Supabase Postgres is the only supported persistence platform for runtime environments, local
   development, integration testing, staging, and production. SQLite support will be retired.
7. The browser continues to use the Node API. It does not receive database credentials or write
   directly to Supabase tables.

## 2. Problem

The existing pipeline intentionally favors precision over recall. A candidate is not saved unless
company identity, target-country presence, commodity relevance, and a requested buyer role are all
supported. This prevents fabricated or weak results, but a normal search can end with zero results
when initial web research finds plausible companies without enough evidence for one mandatory claim.

The enhancement must improve recall without:

- accepting unsupported buyer roles;
- changing the requested country or buyer types;
- weakening source provenance;
- inventing contacts;
- hiding why a candidate failed;
- allowing unbounded model calls or cost;
- mixing incomplete research leads with qualified candidates.

## 3. Current Pipeline Baseline

```text
Validated search input
  -> AI search plan
  -> deterministic plan-invariant enforcement
  -> OpenRouter web research
  -> structured candidate formatting
  -> recovered-source grounding
  -> contact provenance filtering
  -> deterministic deduplication
  -> evidence-completeness ranking
  -> candidate verification
  -> deterministic mandatory checks and confidence score
  -> persist eligible candidates in Supabase Postgres
  -> human review
```

The fallback extends this pipeline. It does not replace any existing validation, grounding,
verification, scoring, or persistence boundary.

## 4. Target Pipeline

```text
Strict pass
  -> enough qualified candidates?
       -> yes: complete normally
       -> no:
            -> classify rejection and missing-evidence reasons
            -> select safe near-miss candidates
            -> build bounded evidence-repair queries
            -> run one supplemental research pass
            -> ground only URLs returned by that pass
            -> merge evidence into canonical candidates
            -> deduplicate
            -> reverify only new or materially improved candidates
            -> reapply the original deterministic eligibility rules
            -> save newly qualified candidates
            -> optionally classify safe unresolved candidates as Research Leads
            -> complete with transparent fallback metrics
```

## 5. Automatic Fallback Trigger

The initial trigger should be:

```text
qualified result count < min(configured minimum qualified results, requested result limit)
```

Recommended default:

```text
BUYER_FALLBACK_ENABLED=true
BUYER_FALLBACK_MIN_QUALIFIED=3
```

Examples:

- A one-result request triggers fallback only when zero candidates qualify.
- A two-result request triggers fallback when fewer than two qualify.
- A ten-result request triggers fallback when fewer than three qualify.

The fallback must not start when:

- it is disabled;
- the run is cancelled or timed out;
- no safe repair candidates or bounded expansion queries can be produced;
- the remaining configured cost budget cannot support the supplemental pass;
- the run has already executed its fallback pass.

## 6. Near-Miss Classification

Add a pure, deterministic classifier that converts candidate evidence and verification outcomes into
one of the following decisions:

### `QUALIFIED`

The candidate already satisfies the current eligibility rules. It is saved normally and is not sent
through fallback.

### `REPAIRABLE`

The candidate has:

- a grounded and distinguishable company identity;
- at least one recovered source URL;
- no target-country contradiction;
- no exclusion match;
- no explicit evidence that it is only a seller or exporter for a buyer-side request;
- one or two missing or ambiguous evidence categories that targeted research could reasonably
  resolve.

Typical repairable cases:

- identity, country, and commodity are supported but buyer-role evidence is missing;
- identity, commodity, and buyer role are supported but target-country presence needs stronger
  evidence;
- mandatory evidence exists but the verifier reports a non-fatal ambiguity between sources;
- an explicitly required website or contact may exist but was not found in the first pass.

### `TERMINAL_REJECTION`

The candidate is not eligible for fallback when it has:

- the wrong country;
- no identifiable company;
- no grounded source;
- a user exclusion match;
- a direct contradiction that cannot be repaired by additional evidence;
- clear evidence that it is only a seller/exporter where buyer-side activity is required;
- primarily unrelated commodity evidence;
- an unsafe or unsupported contact claim.

The classifier and every reason code must be unit tested. Model prose must not determine whether a
candidate is allowed into the repair pass.

## 7. Evidence-Repair Query Construction

Build repair queries in deterministic TypeScript from:

- the original immutable search criteria;
- the canonical company name and official domain, if known;
- the approved commodity aliases and local-language terms;
- the requested buyer types;
- the candidate's missing evidence types;
- the original exclusions.

Examples:

```text
Missing BUYER_ROLE:
  "Company Name" coconut importer UAE
  site:company.example coconut distribution

Missing LOCATION:
  "Company Name" UAE office address
  site:company.example Dubai UAE

Missing COMMODITY:
  site:company.example coconut
  "Company Name" semi-husked coconut

Missing CONTACT when explicitly required:
  site:company.example contact
  site:company.example email phone
```

The query builder must never:

- replace or broaden the target country;
- add an unrequested buyer role;
- remove user exclusions;
- search for named private individuals;
- generate or infer an email address;
- relax `requireWebsite` or `requireContact`;
- produce more than the configured query limit.

When there are too few repairable candidates, the remaining query budget may be used for bounded
discovery expansion. Expansion may use approved aliases, local-language terms, industry
associations, government registries, trade-event directories, and official product catalogues, but
it must preserve the original country and buyer roles.

## 8. Supplemental Research Controls

Recommended configuration:

```text
BUYER_FALLBACK_MAX_SEARCH_CALLS=2
BUYER_FALLBACK_MAX_CANDIDATES=10
BUYER_FALLBACK_ALLOW_RESEARCH_LEADS=false
```

Rules:

- Run no more than one supplemental research pass.
- Count fallback calls, tokens, latency, and cost in the same run telemetry.
- Apply the existing global timeout and maximum-cost ceiling to the combined strict and fallback
  work.
- Reuse a completed fallback search result if only its formatting call is retried.
- Use the same private provider routing and disabled cross-model fallback policy as the strict pass.
- Treat all retrieved content as untrusted data and preserve the existing prompt-injection rules.
- Limit verification concurrency to the existing configured maximum.

## 9. Evidence Merge And Reverification

Supplemental evidence is accepted only when its normalized URL was returned by the supplemental web
search. Contacts are retained only when their `sourceUrl` matches retained evidence.

Merge order:

1. Exact canonical website domain.
2. Exact normalized company name and country.
3. Otherwise retain a separate candidate and preserve any possible-duplicate diagnostic.

The merged candidate must deduplicate sources by normalized URL plus evidence type and contacts by
type plus normalized value.

Reverify only when a candidate is new or materially improved. Material improvement means at least
one of:

- a missing mandatory evidence type was added;
- a new independent source was added;
- an explicitly required website or contact was added;
- contradictory evidence was resolved with stronger grounded evidence.

Do not reverify unchanged terminal rejections. Track already-persisted company-and-buyer-type keys so
the fallback cannot create duplicate matches.

## 10. Final Eligibility And Scoring

The existing deterministic confidence function remains unchanged:

| Signal | Points |
|---|---:|
| Target-country evidence | 20 |
| Direct commodity evidence | 30 |
| Requested buyer-role evidence | 25 |
| Official company website | 10 |
| Public sourced contact method | 10 |
| Multiple consistent sources | 5 |

Company identity, target-country evidence, commodity evidence, and requested buyer-role evidence
remain mandatory. A candidate recovered by fallback must pass the same rules as a strict-pass
candidate. `fallbackPass=1` records provenance; it does not alter the score.

## 11. Research Leads Phase

Research Leads are optional and must remain disabled until the strict fallback has been evaluated.

A Research Lead may be retained only when:

- identity, target country, and commodity relationship are supported;
- at least one grounded source exists;
- no source contradicts the target country or company identity;
- no exclusion matches;
- explicit `requireWebsite` and `requireContact` constraints are satisfied;
- the unresolved issue is buyer-role proof or another explicitly classified non-fatal ambiguity.

Research Leads must:

- appear in a separate `Research leads - more evidence needed` section;
- display missing evidence checks instead of a normal confidence claim;
- never count toward qualified-result targets;
- never be described as verified buyers;
- never trigger outreach or other external actions;
- require a deliberate `Keep for research` user action.

Wrong-country, unidentifiable, source-free, excluded, unrelated, or contradicted candidates are never
Research Leads.

## 12. Supabase Schema Plan

Use a new versioned Supabase migration. Do not edit the existing initial migration.

The run-level fallback summary belongs in the existing `buyer_search_runs.outcome_json` so the
search-run table does not accumulate implementation-specific counters.

For the optional Research Leads phase, add to `buyer_matches`:

```text
qualification_tier text not null default 'QUALIFIED'
  check (qualification_tier in ('QUALIFIED', 'RESEARCH_LEAD'))

missing_evidence_json jsonb
fallback_pass integer not null default 0
  check (fallback_pass in (0, 1))
```

Add an index supporting search result grouping and ordering:

```text
(search_run_id, qualification_tier, confidence_score desc)
```

Keep RLS enabled and keep direct `anon` and `authenticated` table grants revoked. The Node API
continues to access Postgres through its server-side connection. No fallback feature requires
browser-direct table access.

Before applying the migration:

1. Create it with the Supabase CLI migration command.
2. Apply it to the development Supabase project.
3. Verify constraints, indexes, default values, and representative reads/writes.
4. Run Supabase Security Advisor and Performance Advisor.
5. Apply the same committed migration to staging from a clean schema history.

## 13. API Contract

Existing endpoints remain stable. Extend search status and results additively.

Search outcome example:

```json
{
  "summary": {
    "researchedCandidateCount": 12,
    "savedCandidateCount": 2
  },
  "fallback": {
    "triggered": true,
    "reason": "INSUFFICIENT_QUALIFIED_RESULTS",
    "passCount": 1,
    "searchCallCount": 2,
    "repairCandidateCount": 5,
    "reverifiedCandidateCount": 4,
    "recoveredQualifiedCount": 2,
    "researchLeadCount": 0
  }
}
```

Result additions for the optional Research Leads phase:

```json
{
  "qualificationTier": "QUALIFIED",
  "missingEvidence": [],
  "fallbackPass": 1
}
```

All new fields are server-generated. The browser cannot choose a qualification tier or claim that a
candidate passed fallback.

## 14. UI Plan

During fallback, keep the existing run status values and update `currentStage` rather than adding new
database status enum values:

```text
Searching sources
Verifying candidates
Finding additional evidence
Verifying improved candidates
Saving qualified results
```

After completion, show:

- whether additional research ran;
- why it ran;
- how many candidates were rechecked;
- how many qualified candidates were recovered;
- the incremental cost and latency when available.

Qualified results retain the existing presentation. When enabled, Research Leads render in a
separate section below qualified results with visible missing-evidence labels and `Keep for research`
or `Dismiss` actions.

An empty result should explain the dominant failure reasons and offer a new search with suggested
input changes. It must not silently imply that no companies exist in the market.

## 15. Supabase-Only Runtime Transition

Supabase Postgres becomes mandatory before shipping this enhancement.

### Runtime

- Require `DATABASE_URL`; fail startup with a clear error when it is missing.
- Remove `DATABASE_PROVIDER` branching and the implicit SQLite fallback.
- Construct only Postgres costing, load-plan, and buyer repositories.
- Require Supabase Auth in every supported runtime environment.
- Preserve the server-owned `Browser -> Node API -> Supabase Postgres` boundary.

### Local development

- Use a dedicated Supabase development project or a local Supabase CLI stack backed by Postgres.
- Keep development credentials in an uncommitted environment file.
- Apply committed migrations before starting the app.
- Do not share production credentials with local development.

### Tests

- Keep pure domain tests database-free.
- Replace SQLite-backed orchestrator, runtime, job-runner, and API tests with deterministic in-memory
  repository test doubles.
- Run Postgres repository integration tests against an isolated Supabase development/test database.
- Use unique test IDs and transactional or explicit fixture cleanup that cannot touch non-test rows.
- Keep staging smoke tests separate from the fast unit suite.

### Removal scope

After the final SQLite-to-Postgres data reconciliation is confirmed, remove:

- `scripts/sqliteCostingRepository.mjs`;
- `scripts/sqliteLoadPlanRepository.mjs`;
- `scripts/sqliteBuyerRepository.mjs`;
- SQLite provider selection from `scripts/persistence.mjs`;
- SQLite repository test files and imports;
- SQLite-backed evaluation storage;
- the SQLite data-import command and script after it is archived or explicitly declared no longer
  needed;
- documentation that describes SQLite as a supported runtime or test provider.

Historical milestone notes may continue to mention SQLite as history, but no active setup or
architecture section may present it as supported.

## 16. Implementation Phases

### Phase A: Supabase-only foundation

1. Confirm all required historical records exist in Supabase.
2. Record final table counts and representative record checks.
3. Make Postgres configuration mandatory and remove runtime provider branching.
4. Replace SQLite-backed unit fixtures with in-memory repository doubles.
5. Remove SQLite implementation and active documentation.
6. Run build, unit tests, Postgres integration tests, authenticated smoke tests, and advisors.

### Phase B: Strict fallback domain design

1. Add fallback configuration parsing and validation.
2. Add typed missing-evidence and fallback reason codes.
3. Implement and test deterministic near-miss classification.
4. Implement and test bounded evidence-repair query construction.
5. Extend run outcome schemas with fallback diagnostics.

### Phase C: Supplemental orchestration

1. Execute the strict pass unchanged.
2. Trigger fallback using the configured threshold.
3. Run one supplemental research pass.
4. Ground and merge supplemental evidence.
5. Reverify only new or materially improved candidates.
6. Apply unchanged eligibility and scoring rules.
7. Persist recovered qualified candidates idempotently.
8. Record combined and incremental telemetry.

### Phase D: API and UI

1. Return fallback outcome fields from search status.
2. Show fallback progress stages.
3. Explain recovered and unresolved candidate counts.
4. Improve zero-result messaging with safe search suggestions.
5. Preserve existing history and reopening behavior.

### Phase E: Optional Research Leads

1. Add the Supabase migration and repository fields.
2. Add the separate qualification-tier contract.
3. Add API serialization and result grouping.
4. Add the separate UI section and review wording.
5. Enable only after evaluation proves acceptable precision and user value.

### Phase F: Evaluation and rollout

1. Add zero-result and sparse-result fixtures to the versioned evaluation set.
2. Compare strict-only and strict-plus-fallback configurations.
3. Measure qualified-result recovery, false-positive change, added latency, and added cost.
4. Review every fallback-recovered candidate in the live comparison.
5. Roll out behind configuration, observe real internal searches, then decide whether Research Leads
   should be enabled.

## 17. Test Matrix

Required automated coverage:

- fallback does not run when the strict result threshold is met;
- fallback runs once when the threshold is missed;
- fallback never runs twice after retry or formatter recovery;
- country, area, buyer roles, exclusions, website, and contact requirements remain immutable;
- terminal rejections are not selected for repair;
- query construction is bounded and deterministic;
- supplemental URLs must be recovered from the supplemental search response;
- unsupported supplemental contacts are removed;
- evidence and contacts merge without duplication;
- unchanged candidates are not reverified;
- recovered candidates pass the original mandatory rules;
- already-saved matches are not duplicated;
- cancellation interrupts fallback;
- timeout and cost ceilings include fallback work;
- telemetry separates strict and fallback usage while preserving totals;
- Research Leads never appear in the qualified list;
- Postgres repository reads and writes preserve qualification fields;
- anonymous API requests remain rejected;
- no browser bundle contains database or secret credentials.

## 18. Evaluation Gates

Compare strict-only against strict-plus-fallback using the same versioned fixtures and model
configuration.

Required reported metrics:

- zero-result run rate;
- average qualified candidates per run;
- precision of recovered qualified candidates;
- target-country accuracy;
- buyer-role accuracy;
- source coverage and provenance accuracy;
- fabricated-contact count;
- duplicate rate;
- fallback trigger rate;
- incremental tokens, cost, and latency;
- percentage of repair attempts that recover at least one qualified candidate.

Recommended release gates:

- zero fabricated contacts;
- no reduction in accepted target-country or buyer-role accuracy;
- every recovered candidate has grounded mandatory evidence;
- no duplicate persisted matches from fallback;
- fallback executes no more than once;
- median incremental fallback latency and cost are documented and accepted;
- the zero-result rate improves materially on the reviewed evaluation set.

Research Leads require a separate human-reviewed acceptance decision and must not be used to make the
strict fallback quality gate appear better.

## 19. Observability

Log structured, non-secret events for:

- fallback eligibility decision;
- fallback trigger reason;
- repair and expansion query counts, but not prompts containing sensitive data;
- candidates selected for repair by stable IDs;
- evidence categories added;
- candidates reverified and recovered;
- strict and fallback token, cost, and latency totals;
- cancellation, timeout, budget exhaustion, and upstream failure stage.

Do not log access tokens, database credentials, full prompt payloads, private data, or unredacted
contact values.

## 20. Failure And Recovery Rules

- If fallback fails after the strict pass produced qualified results, complete the run with those
  strict results and record a non-fatal fallback warning.
- If strict and fallback both produce no qualified results, complete successfully with zero results
  and explain the dominant rejection reasons. Zero results is not itself a system error.
- If an overall timeout, cancellation, or maximum-cost breach occurs, use the existing terminal run
  behavior.
- Never repeat a completed paid web-search call solely because formatting failed; reuse its research
  checkpoint.
- Persist recovered candidates transactionally and idempotently.

## 21. Definition Of Done

The enhancement is complete when:

1. Supabase Postgres is the only supported runtime and integration-test persistence platform.
2. Missing database or Supabase Auth configuration fails fast with a useful startup error.
3. SQLite runtime adapters, provider branching, and active SQLite test dependencies are removed.
4. The strict pipeline behavior remains unchanged when fallback does not trigger.
5. Fallback runs at most once and never broadens user constraints.
6. Supplemental evidence passes the same provenance checks as initial evidence.
7. Recovered candidates pass the original deterministic eligibility and confidence rules.
8. The UI and API expose fallback progress and outcome diagnostics.
9. Research Leads, if enabled, are persisted and displayed separately from qualified results.
10. Evaluation demonstrates improved recall without an unacceptable precision, cost, or latency
    regression.
11. Supabase migrations apply cleanly from an empty staging database.
12. Supabase Security Advisor and Performance Advisor have no unresolved critical findings.
13. Build, tests, authenticated smoke tests, and relevant repository integration tests pass.
14. Remaining limitations and rollout configuration are documented.
