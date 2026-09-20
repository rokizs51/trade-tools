import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createPostgresClient } from "./postgresClient.mjs";

const migrationsDirectory = resolve("supabase", "migrations");
const sql = createPostgresClient();

try {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await sql.file(join(migrationsDirectory, file));
    console.log(`Applied ${file}`);
  }
} finally {
  await sql.end();
}
