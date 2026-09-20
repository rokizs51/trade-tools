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
DATABASE_IDLE_TIMEOUT_SECONDS=300
```

The five-minute session idle timeout keeps a connection warm through normal interactive pauses and
avoids repeatedly paying the remote TLS and pooler handshake. Short-lived/serverless deployments
using transaction pooling default to 20 seconds instead. Override the value only after measuring the
deployment's connection limits and traffic pattern.

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
- Supabase authentication is implemented; all invited internal users intentionally share application data.
- Workspace authorization remains documented as an optional future phase if separate data boundaries are needed.

## Authentication

Supabase Postgres deployments require Supabase Auth. Add the browser-safe project settings to the
server environment:

```text
AUTH_MODE=supabase
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`SUPABASE_PUBLISHABLE_KEY` is intentionally sent to the browser. Do not substitute a secret key,
service-role key, database password, or `DATABASE_URL`.

In the Supabase dashboard:

1. Open Authentication settings and disable public user sign-ups.
2. Keep email/password authentication enabled.
3. Invite or create each internal user through Authentication > Users.
4. Prefer an asymmetric Auth signing key so the Node server can verify tokens locally through JWKS.
   Legacy HS256 tokens remain supported, but require a request to the regional Auth user endpoint on
   every verification and are therefore slower.
5. Set the Site URL and allowed redirect URLs to the deployed application origin before production.

The application provides sign-in, sign-out, saved-session restoration, automatic access-token
refresh, and expired-session recovery. Every `/api/*` route requires a Bearer access token;
`GET /health` and the browser authentication configuration script remain public. The server validates
signature, issuer, audience, expiration, subject, and authenticated role before serving an API
request.

SQLite local development defaults to `AUTH_MODE=disabled`. Disabling authentication is rejected when
the active persistence provider is Postgres.

Authentication proves who the user is. In the current invite-only internal deployment, every invited
user can access the shared application records. Add the planned workspace authorization phase before
introducing separate organizations or users who should not share data.

## Remaining deployment verification

Before production cutover, apply the migration to a staging Supabase project and run the authenticated
API smoke tests against that project. Connection credentials are intentionally not committed to this
repository.
