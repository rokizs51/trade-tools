import { createPostgresBuyerRepository } from "./postgresBuyerRepository.mjs";
import { createPostgresClient } from "./postgresClient.mjs";
import { createPostgresCostingRepository } from "./postgresCostingRepository.mjs";
import { createPostgresLoadPlanRepository } from "./postgresLoadPlanRepository.mjs";

export function createPersistence({ root = process.cwd(), env = process.env } = {}) {
  const provider = resolveDatabaseProvider(env);
  void root;
  const sql = createPostgresClient(env);
  return {
    provider,
    costingRepository: createPostgresCostingRepository(sql),
    loadPlanRepository: createPostgresLoadPlanRepository(sql),
    buyerRepository: createPostgresBuyerRepository(sql),
    async close() { await sql.end(); },
  };
}

export function resolveDatabaseProvider(env = process.env) {
  const explicit = env.DATABASE_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== "postgres") {
    throw new Error("SQLite persistence is no longer supported; DATABASE_PROVIDER must be postgres.");
  }

  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Supabase Postgres is the only supported persistence provider.");
  }

  return "postgres";
}
