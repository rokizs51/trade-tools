# Buyer Finder Evaluation Set

Status: Initial Milestone 0 fixture set

The executable fixture definitions live in `test/fixtures/buyerFinderEvaluations.mjs`.

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
