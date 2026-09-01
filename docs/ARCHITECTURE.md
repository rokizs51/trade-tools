# Architecture

Frontend:
Next.js / React

Backend:
Next.js API or separate backend

Database:
PostgreSQL

ORM:
Prisma

Validation:
Zod

Authentication:
TBD / simple internal authentication

Principles:
- Financial calculations use decimal arithmetic.
- Calculation engine must not depend on UI.
- Cost items are flexible rows, not fixed DB columns.
- Business logic must have unit tests.
- UI complexity should remain hidden by default.