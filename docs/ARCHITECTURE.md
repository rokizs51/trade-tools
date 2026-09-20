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
Not implemented yet; planned as the next production-readiness step

Principles:
- Financial calculations use decimal arithmetic.
- Calculation engine must not depend on UI.
- Cost items are flexible rows, not fixed DB columns.
- Business logic must have unit tests.
- UI complexity should remain hidden by default.
- Database credentials remain server-side.
- Supabase browser roles have no direct table access until explicit authenticated policies are designed.
