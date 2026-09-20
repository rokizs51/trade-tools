# Supabase Performance Baseline

Use this document to distinguish application query overhead from unavoidable network distance.

## Benchmark command

```powershell
npm run performance:db
```

The command is read-only. It reports the first costing-list request, then warm medians for costing
history, load-plan history, Buyer Finder search history, and the newest run's hydrated results. Use
`npm run performance:db -- --iterations=5` for a larger sample.

## Baseline before Phase 7.1

Measured on 2026-09-20 from the local development machine in Jakarta through the Supabase session
pooler to the Sydney project:

- First connection and trivial query: approximately 2,695 ms.
- Typical warm database round trip: approximately 259-260 ms.
- The database execution plan for the costing list completed in approximately 0.15 ms, showing that
  transport and connection overhead dominated query execution.
- Hydrating five Buyer Finder matches required 11 sequential SQL round trips (`1 + 2N`), implying
  approximately 2.8 seconds of network latency before meaningful query work.
- Application startup requested both active and archived costing and load-plan lists even when those
  screens were not visible.

## Phase 7.1 acceptance envelope

These targets apply to the current Jakarta-to-Sydney development path and should be re-established
for the production host:

- Opening a calculator workspace makes no costing or load-plan list request.
- Opening active and then archived history uses one shared list request per resource until a local
  mutation invalidates it.
- A costing or load-plan mutation refreshes both visible datasets with one list request.
- Buyer result hydration executes one joined SQL statement for any result count from 1 through 25.
- A warm single-list request should normally complete within 500 ms from the current development
  location.
- Warm Buyer Finder hydration should normally complete within 1,500 ms from the current development
  location.

The latency thresholds are operational expectations, not deterministic unit-test limits. Record
several samples and investigate sustained regressions rather than failing tests on internet jitter.

## Implemented changes

- History data is lazy-loaded only when its workspace is opened.
- Costing and load-plan active/archive views share an in-memory request and result cache.
- Successful mutations invalidate and refresh each resource list once.
- Buyer Finder matches, sources, and contacts are loaded in one joined query rather than two extra
  queries per match.
- Session-pooler connections remain warm for five minutes by default; transaction-pooler deployments
  retain the shorter 20-second default.
- A query-count regression test fixes Buyer Finder hydration at one statement for non-empty
  result sets.

## Verification after Phase 7.1

Measured on 2026-09-20 from the same local development machine and Sydney Supabase project, with
three warm samples per operation:

| Operation | Warm median | Result count |
|---|---:|---:|
| Costing list | 269.3 ms | 1 |
| Load-plan list | 268.7 ms | 0 |
| Buyer search history | 273.9 ms | 3 |
| Buyer result hydration | 284.7 ms | 6 |

The first connection plus costing query took 3,045 ms. This remains dominated by opening a remote
connection to Sydney; keeping the session alive prevents that cost from recurring during normal
interactive use.

An intermediate three-query Buyer Finder implementation measured a 4,450.9 ms warm median for six
results. Combining matches, sources, and contacts into one joined query reduced the verified median
to 284.7 ms, comfortably inside the 1,500 ms development envelope.

## Region decision

Optimize and remeasure before creating a replacement project. If warm latency remains unacceptable
from the production application host, compare the same benchmark against a staging project in a
closer region such as Singapore. A Cloudflare Tunnel changes access to the application but does not
shorten the application's Postgres connection to Supabase.
