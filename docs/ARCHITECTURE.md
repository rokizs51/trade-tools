# Architecture

Frontend:
TypeScript single-page browser application

Backend:
Node.js HTTP server and JSON API

Database:
Supabase Postgres in every supported runtime environment. Local development uses a dedicated
Supabase development project or a local Supabase CLI Postgres stack. Runtime startup now requires
`DATABASE_URL` and rejects SQLite configuration. Remaining SQLite files are legacy importer/test
code only and must not receive new features.

Database access:
Postgres.js on the server; repository boundary keeps domain logic database-independent

Validation:
Zod

Authentication:
Supabase Auth with invite-only users. The browser manages the Supabase session and sends the access
token to the Node API. The Node server verifies asymmetric JWTs through the project's JWKS endpoint
and falls back to the Supabase Auth user endpoint for legacy HS256 tokens. Supabase Postgres cannot
start with authentication disabled. Workspace authorization is the next deployment-readiness phase.

Principles:
- Financial calculations use decimal arithmetic.
- Calculation engine must not depend on UI.
- Cost items are flexible rows, not fixed DB columns.
- Business logic must have unit tests.
- UI complexity should remain hidden by default.
- Database credentials remain server-side.
- The application must fail fast when Supabase Postgres configuration is missing; there is no
  supported SQLite runtime fallback.
- Supabase browser roles have no direct table access until explicit authenticated policies are designed.
- Authentication establishes identity only; repository-level workspace authorization remains a future
  requirement if the tool expands beyond one trusted internal team.
- Buyer Finder keeps an append-only, server-owned event timeline in Supabase Postgres and emits the
  same safe structured events to server logs. It records lifecycle, progress, model-call timing and
  usage, fallback, cancellation, and failures without recording credentials or raw model content.
