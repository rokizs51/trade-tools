# Supabase Postgres Deployment

The production persistence provider is Supabase Postgres. SQLite remains available only for local
development and the fast repository test suite.

## 1. Create and configure the database

Create a Supabase project, open the dashboard **Connect** panel, and copy the connection string.

- Use a direct connection or session pooler for this long-lived Node server.
- Use the transaction pooler only when deploying the server as short-lived/serverless instances.
- Never expose `DATABASE_URL` to browser code.

Configure the server environment:

```text
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://...
DATABASE_POOL_MODE=session
DATABASE_MAX_CONNECTIONS=5
```

For the transaction pooler, set `DATABASE_POOL_MODE=transaction`. The application then disables
prepared statements and defaults to a single connection per warm instance.

## 2. Apply the schema

```powershell
npm run db:migrate
```

The migration creates costings, load plans, buyer searches, companies, matches, evidence, and
contacts. It enables Row Level Security and revokes all table access from Supabase's `anon` and
`authenticated` roles. The current application accesses Postgres only from its trusted server.

## 3. Start the application

To copy existing local records after applying the schema:

```powershell
npm run db:migrate:data
```

Set `SQLITE_SOURCE_PATH` only when the source is not `data/costings.sqlite`. The import is
non-destructive and skips IDs already present in Postgres.

## 4. Start the application

```powershell
npm run dev
```

Startup prints `Database: Supabase Postgres` when the production provider is active. If neither
`DATABASE_PROVIDER=postgres` nor `DATABASE_URL` is configured, the app retains the local SQLite
fallback.

## Security boundary

- Database credentials are server-only.
- No Supabase secret/service key is sent to the browser.
- Browser roles have no direct table grants.
- Authentication and per-user/workspace authorization remain a separate Milestone 7 task.

## Remaining deployment verification

Before production cutover, apply the migration to a staging Supabase project and run the API smoke
tests against that project. Connection credentials are intentionally not committed to this repository.
