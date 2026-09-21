import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveDatabaseProvider } from "../scripts/persistence.mjs";
import { readPostgresConfig } from "../scripts/postgresClient.mjs";

test("persistence requires Supabase Postgres configuration", () => {
  assert.throws(() => resolveDatabaseProvider({}), /DATABASE_URL is required/);
  assert.equal(resolveDatabaseProvider({ DATABASE_URL: "postgresql://example" }), "postgres");
  assert.throws(
    () => resolveDatabaseProvider({ DATABASE_PROVIDER: "sqlite", DATABASE_URL: "postgresql://example" }),
    /SQLite persistence is no longer supported/,
  );
  assert.throws(() => resolveDatabaseProvider({ DATABASE_PROVIDER: "postgres" }), /DATABASE_URL is required/);
  assert.throws(() => resolveDatabaseProvider({ DATABASE_PROVIDER: "other", DATABASE_URL: "postgresql://example" }), /must be postgres/);
});

test("Postgres configuration is safe for session and transaction poolers", () => {
  assert.deepEqual(readPostgresConfig({ DATABASE_URL: "postgresql://example" }), {
    connectionString: "postgresql://example",
    poolMode: "session",
    maxConnections: 5,
    idleTimeoutSeconds: 300,
  });
  assert.deepEqual(readPostgresConfig({
    DATABASE_URL: "postgresql://example:6543/postgres",
    DATABASE_POOL_MODE: "transaction",
  }), {
    connectionString: "postgresql://example:6543/postgres",
    poolMode: "transaction",
    maxConnections: 1,
    idleTimeoutSeconds: 20,
  });
  assert.deepEqual(readPostgresConfig({
    DATABASE_URL: "postgresql://example",
    DATABASE_MAX_CONNECTIONS: "3",
    DATABASE_IDLE_TIMEOUT_SECONDS: "600",
  }), {
    connectionString: "postgresql://example",
    poolMode: "session",
    maxConnections: 3,
    idleTimeoutSeconds: 600,
  });
  assert.throws(
    () => readPostgresConfig({ DATABASE_URL: "postgresql://example", DATABASE_POOL_MODE: "invalid" }),
    /session or transaction/,
  );
  assert.throws(
    () => readPostgresConfig({ DATABASE_URL: "postgresql://example", DATABASE_IDLE_TIMEOUT_SECONDS: "0" }),
    /DATABASE_IDLE_TIMEOUT_SECONDS must be a positive integer/,
  );
});

test("Supabase migration creates every repository table and blocks browser roles", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260918130925_trade_tools_initial_schema.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "costings", "load_plans", "buyer_search_runs", "buyer_companies",
    "buyer_matches", "buyer_sources", "buyer_contacts",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
});

test("workspace authorization prototype is followed by a rollback migration", () => {
  const rollback = readFileSync(
    new URL("../supabase/migrations/20260920124247_revert_single_workspace_authorization.sql", import.meta.url),
    "utf8",
  );

  assert.match(rollback, /drop table if exists public\.workspace_members/);
  assert.match(rollback, /drop table if exists public\.workspaces/);
  assert.match(rollback, /alter table public\.costings drop column if exists workspace_id/);
  assert.match(rollback, /alter table public\.buyer_search_runs drop column if exists created_by/);
});

test("Buyer Finder event migration keeps operational events private and queryable by run", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260921093000_add_buyer_search_events.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /create table if not exists public\.buyer_search_events/);
  assert.match(migration, /references public\.buyer_search_runs\(id\) on delete cascade/);
  assert.match(migration, /buyer_search_events_run_created_idx/);
  assert.match(migration, /alter table public\.buyer_search_events enable row level security/);
  assert.match(migration, /revoke all on table public\.buyer_search_events from anon, authenticated/);
});
