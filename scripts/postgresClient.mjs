import postgres from "postgres";

export function readPostgresConfig(env = process.env) {
  const connectionString = env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=postgres.");
  }

  const poolMode = env.DATABASE_POOL_MODE?.trim().toLowerCase() || "session";

  if (!["session", "transaction"].includes(poolMode)) {
    throw new Error("DATABASE_POOL_MODE must be session or transaction.");
  }

  return {
    connectionString,
    poolMode,
    maxConnections: positiveInteger(
      env.DATABASE_MAX_CONNECTIONS,
      poolMode === "transaction" ? 1 : 5,
      "DATABASE_MAX_CONNECTIONS",
    ),
    idleTimeoutSeconds: positiveInteger(
      env.DATABASE_IDLE_TIMEOUT_SECONDS,
      poolMode === "transaction" ? 20 : 300,
      "DATABASE_IDLE_TIMEOUT_SECONDS",
    ),
  };
}

export function createPostgresClient(env = process.env) {
  const config = readPostgresConfig(env);

  return postgres(config.connectionString, {
    max: config.maxConnections,
    prepare: config.poolMode !== "transaction",
    ssl: "require",
    idle_timeout: config.idleTimeoutSeconds,
    connect_timeout: 15,
  });
}

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
