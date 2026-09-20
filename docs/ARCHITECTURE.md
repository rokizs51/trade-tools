# Architecture

Frontend:
TypeScript single-page browser application

Backend:
Node.js HTTP server and JSON API

Database:
Supabase Postgres in production; SQLite for local development and fast tests

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
- Supabase browser roles have no direct table access until explicit authenticated policies are designed.
- Authentication establishes identity only; repository-level workspace authorization remains a future
  requirement if the tool expands beyond one trusted internal team.
