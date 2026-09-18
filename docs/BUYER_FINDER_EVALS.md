# Buyer Finder Evaluation Set

Status: Milestone 6 evaluation harness implemented; reviewed live benchmark pending

The executable fixture definitions live in `test/fixtures/buyerFinderEvaluations.mjs`.
Prompt-injection attack strings live in `test/fixtures/buyerFinderPromptInjectionAttacks.mjs`.

## Purpose

The buyer finder must be evaluated against repeatable search scenarios rather than judged from one successful demonstration.

The initial set covers:

- Common commodities with many possible companies.
- Niche commodities with weak evidence.
- Ambiguous commodity terminology.
- Local-language discovery.
- Country and city filtering.
- HS-code-assisted planning.
- Buyer-role precision.
- Similar company names.
- Conflicting location evidence.
- Cases where returning fewer results is better than inventing candidates.

## Human Review Rubric

For each returned candidate, record:

| Field | Allowed values |
|---|---|
| Relevant candidate | Yes / No |
| Correct target country | Yes / No |
| Requested buyer role supported | Yes / No / Unclear |
| Commodity relationship supported | Yes / No |
| Company identity established | Yes / No |
| Contact source valid | Yes / No / Not present |
| Official website identified | Yes / No / Unclear |
| Duplicate of another result | Yes / No |
| Unsupported factual claim | Yes / No |
| Reviewer notes | Free text |

## Run-Level Metrics

Calculate:

- Precision at 5.
- Precision at 10.
- Target-country accuracy.
- Buyer-role accuracy.
- Evidence completeness.
- Contact accuracy.
- Unsupported-claim rate.
- Duplicate rate.
- Number of accepted candidates.
- Number of low-evidence abstentions.
- End-to-end latency.
- Input and output token usage.
- Estimated total cost.
- Source coverage and contact-to-source provenance.
- Median latency and median cost by model configuration.

## Initial Release Thresholds

- At least 80% of the top 10 results are relevant.
- At least 95% match the requested country.
- Every result contains at least one retained source.
- Every displayed contact maps to a retained source.
- No fabricated email address or phone number.
- Duplicate rate remains below 5% after deterministic normalization.

## Evaluation Procedure

1. Pin planner, researcher, and verifier model IDs.
2. Pin prompt versions and run budgets.
3. Run every fixture once without manual intervention.
4. Save sources and model/provider metadata.
5. Review candidates using the rubric above.
6. Aggregate metrics across all fixtures.
7. Repeat only when comparing a documented prompt, model, or orchestration change.

Do not add hand-picked exclusions after seeing one model's results unless the exclusion represents a general product rule and is added to every comparable configuration.

## Running A Model Comparison

The live command always compares the configured baseline against a candidate configuration. It
refuses to run unless `--confirm-live` is present and at least one candidate model differs. This
keeps ordinary builds and tests free of paid network requests.

Set one or more candidate model variables in the local `.env` file:

```text
BUYER_EVAL_CANDIDATE_PLANNER_MODEL
BUYER_EVAL_CANDIDATE_RESEARCH_MODEL
BUYER_EVAL_CANDIDATE_FORMATTER_MODEL
BUYER_EVAL_CANDIDATE_VERIFIER_MODEL
```

Optionally limit the first comparison to named fixture IDs:

```text
BUYER_EVAL_FIXTURES=coconut-uae-importers,niche-low-evidence
BUYER_EVAL_MAX_RUNS=4
```

Then run:

```powershell
npm run buyer:eval -- --confirm-live
```

The command runs each selected fixture once per configuration and writes a review JSON file under
`data/buyer-evaluations/`. Reports contain public research results and telemetry but never the API
key. The directory is ignored by Git.

Complete every `candidate.review` field using the rubric above, then score the file:

```powershell
npm run buyer:eval:score -- data/buyer-evaluations/<evaluation-file>.json
```

The scorer refuses partial candidate reviews. Its JSON output compares quality, evidence, latency,
token usage, and cost, and evaluates the documented release thresholds for each configuration.

## Hardening Included In Milestone 6

- Research and verifier prompts explicitly treat page content and excerpts as untrusted data.
- Hostile instructions cannot directly access persistence, filesystem, shell, messaging, or email
  tools because those capabilities are absent from the model boundary.
- A completed web-search response is checkpointed in memory. If evidence formatting encounters a
  retryable failure, the formatter retries from that checkpoint instead of repeating paid search.
- Evaluation metrics and threshold calculations are deterministic and unit tested.
- Live evaluation requires an explicit credit-consuming command and has a maximum-run guard.

## Completion Gate

The Milestone 6 implementation is complete when the harness and hardening tests pass. The product
quality gate remains pending until both configurations have been run across the full fixture set,
every returned candidate has been reviewed, and the selected configuration meets the thresholds or
its exceptions are explicitly accepted.
