import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

import { createPostgresClient } from "./postgresClient.mjs";

const sqlitePath = resolve(process.env.SQLITE_SOURCE_PATH || "data/costings.sqlite");

if (!existsSync(sqlitePath)) {
  throw new Error(`SQLite source database does not exist: ${sqlitePath}`);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const sql = createPostgresClient();

try {
  const tables = [
    ["costings", ["costs_json", "exchange_rates_json", "pricing_json", "result_json"]],
    ["load_plans", ["cargo_input_json", "result_json", "comparisons_json"]],
    ["buyer_search_runs", ["input_json", "plan_json", "model_config_json", "outcome_json"]],
    ["buyer_companies", []],
    ["buyer_matches", []],
    ["buyer_sources", []],
    ["buyer_contacts", []],
  ];
  const summary = {};

  await sql.begin(async (tx) => {
    const insertRow = {
      costings: (row) => tx`insert into public.costings ${tx(row)} on conflict (id) do nothing returning id`,
      load_plans: (row) => tx`insert into public.load_plans ${tx(row)} on conflict (id) do nothing returning id`,
      buyer_search_runs: (row) => tx`insert into public.buyer_search_runs ${tx(row)} on conflict (id) do nothing returning id`,
      buyer_companies: (row) => tx`insert into public.buyer_companies ${tx(row)} on conflict (id) do nothing returning id`,
      buyer_matches: (row) => tx`insert into public.buyer_matches ${tx(row)} on conflict (id) do nothing returning id`,
      buyer_sources: (row) => tx`insert into public.buyer_sources ${tx(row)} on conflict (id) do nothing returning id`,
      buyer_contacts: (row) => tx`insert into public.buyer_contacts ${tx(row)} on conflict (id) do nothing returning id`,
    };

    for (const [tableName, jsonColumns] of tables) {
      const rows = readTable(sqlite, tableName).map((row) => convertRow(tableName, row, jsonColumns));
      let inserted = 0;

      for (const row of rows) {
        const result = await insertRow[tableName](row);
        inserted += result.length;
      }

      summary[tableName] = { sourceRows: rows.length, insertedRows: inserted };
    }
  });

  console.log(JSON.stringify({ source: sqlitePath, tables: summary }, null, 2));
} finally {
  sqlite.close();
  await sql.end();
}

function readTable(db, tableName) {
  const exists = db.prepare(
    "select 1 from sqlite_master where type = 'table' and name = ?",
  ).get(tableName);
  return exists ? db.prepare(`select * from ${tableName}`).all() : [];
}

function convertRow(tableName, source, jsonColumns) {
  const row = { ...source };

  for (const column of jsonColumns) {
    if (row[column] !== null && row[column] !== undefined) {
      row[column] = JSON.stringify(JSON.parse(row[column]));
    }
  }

  if (tableName === "buyer_contacts") {
    row.is_public_business_contact = row.is_public_business_contact === 1;
  }

  return row;
}
