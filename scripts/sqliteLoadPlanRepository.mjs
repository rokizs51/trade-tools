import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createSqliteLoadPlanRepository(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS load_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      product TEXT NOT NULL,
      container_id TEXT NOT NULL,
      cartons_loaded INTEGER NOT NULL,
      total_units INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cargo_input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      comparisons_json TEXT NOT NULL
    );
  `);
  ensureStatusColumn(db);

  return {
    list() {
      return db
        .prepare("SELECT * FROM load_plans ORDER BY updated_at DESC")
        .all()
        .map(rowToSavedLoadPlan);
    },

    get(id) {
      const row = db.prepare("SELECT * FROM load_plans WHERE id = ?").get(id);
      return row ? rowToSavedLoadPlan(row) : undefined;
    },

    save(draft, options) {
      const existing = options.existingId ? this.get(options.existingId) : undefined;
      const saved = {
        ...draft,
        id: existing?.id ?? options.createId(),
        status: existing?.status ?? "ACTIVE",
        createdAt: existing?.createdAt ?? options.now,
        updatedAt: options.now,
      };

      db.prepare(`
        INSERT INTO load_plans (
          id,
          name,
          product,
          container_id,
          cartons_loaded,
          total_units,
          status,
          created_at,
          updated_at,
          cargo_input_json,
          result_json,
          comparisons_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          product = excluded.product,
          container_id = excluded.container_id,
          cartons_loaded = excluded.cartons_loaded,
          total_units = excluded.total_units,
          status = excluded.status,
          updated_at = excluded.updated_at,
          cargo_input_json = excluded.cargo_input_json,
          result_json = excluded.result_json,
          comparisons_json = excluded.comparisons_json
      `).run(...savedLoadPlanToParams(saved));

      return saved;
    },

    archive(id, now) {
      const existing = this.get(id);

      if (!existing) {
        return undefined;
      }

      db.prepare("UPDATE load_plans SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now, id);
      return this.get(id);
    },

    delete(id) {
      const result = db.prepare("DELETE FROM load_plans WHERE id = ?").run(id);
      return result.changes > 0;
    },

    close() {
      db.close();
    },
  };
}

function rowToSavedLoadPlan(row) {
  const cargoInput = JSON.parse(row.cargo_input_json);
  const result = JSON.parse(row.result_json);

  return {
    id: row.id,
    name: row.name,
    cargoInput,
    containerId: row.container_id,
    loadingMode: "FLOOR_LOADED",
    result,
    comparisons: JSON.parse(row.comparisons_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function savedLoadPlanToParams(saved) {
  return [
    saved.id,
    saved.name,
    saved.cargoInput.productName ?? "",
    saved.containerId,
    saved.result.cartonsLoaded,
    saved.result.totalUnits,
    saved.status,
    saved.createdAt,
    saved.updatedAt,
    JSON.stringify(saved.cargoInput),
    JSON.stringify(saved.result),
    JSON.stringify(saved.comparisons),
  ];
}

function ensureStatusColumn(db) {
  const columns = db.prepare("PRAGMA table_info(load_plans)").all();
  const hasStatus = columns.some((column) => column.name === "status");

  if (!hasStatus) {
    db.exec("ALTER TABLE load_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';");
  }
}
