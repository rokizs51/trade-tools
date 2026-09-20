import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveDatabaseProvider } from "../scripts/persistence.mjs";
import { readPostgresConfig } from "../scripts/postgresClient.mjs";

test("persistence defaults to SQLite and selects Postgres when configured", () => {
  assert.equal(resolveDatabaseProvider({}), "sqlite");
  assert.equal(resolveDatabaseProvider({ DATABASE_URL: "postgresql://example" }), "postgres");
  assert.equal(resolveDatabaseProvider({ DATABASE_PROVIDER: "sqlite", DATABASE_URL: "postgresql://example" }), "sqlite");
  assert.throws(() => resolveDatabaseProvider({ DATABASE_PROVIDER: "postgres" }), /DATABASE_URL is required/);
  assert.throws(() => resolveDatabaseProvider({ DATABASE_PROVIDER: "other" }), /sqlite or postgres/);
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
