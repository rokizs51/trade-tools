import { join } from "node:path";

import { createPostgresBuyerRepository } from "./postgresBuyerRepository.mjs";
import { createPostgresClient } from "./postgresClient.mjs";
import { createPostgresCostingRepository } from "./postgresCostingRepository.mjs";
import { createPostgresLoadPlanRepository } from "./postgresLoadPlanRepository.mjs";
import { createSqliteBuyerRepository } from "./sqliteBuyerRepository.mjs";
import { createSqliteCostingRepository } from "./sqliteCostingRepository.mjs";
import { createSqliteLoadPlanRepository } from "./sqliteLoadPlanRepository.mjs";

export function createPersistence({ root = process.cwd(), env = process.env } = {}) {
  const provider = resolveDatabaseProvider(env);

  if (provider === "postgres") {
    const sql = createPostgresClient(env);
    return {
      provider,
      costingRepository: createPostgresCostingRepository(sql),
      loadPlanRepository: createPostgresLoadPlanRepository(sql),
      buyerRepository: createPostgresBuyerRepository(sql),
      async close() { await sql.end(); },
    };
  }

  const databasePath = join(root, "data", "costings.sqlite");
  const costingRepository = createSqliteCostingRepository(databasePath);
  const loadPlanRepository = createSqliteLoadPlanRepository(databasePath);
  const buyerRepository = createSqliteBuyerRepository(databasePath);
  return {
    provider,
    databasePath,
    costingRepository,
    loadPlanRepository,
    buyerRepository,
    close() {
      costingRepository.close();
      loadPlanRepository.close();
      buyerRepository.close();
    },
  };
}

export function resolveDatabaseProvider(env = process.env) {
  const explicit = env.DATABASE_PROVIDER?.trim().toLowerCase();
  const provider = explicit || (env.DATABASE_URL?.trim() ? "postgres" : "sqlite");

  if (!["sqlite", "postgres"].includes(provider)) {
    throw new Error("DATABASE_PROVIDER must be sqlite or postgres.");
  }

  if (provider === "postgres" && !env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=postgres.");
  }

  return provider;
}
