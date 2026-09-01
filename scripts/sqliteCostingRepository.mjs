import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createSqliteCostingRepository(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS costings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity_value TEXT NOT NULL,
      quantity_unit TEXT NOT NULL,
      incoterm TEXT NOT NULL,
      quotation_currency TEXT NOT NULL,
      usd_idr TEXT,
      pricing_type TEXT NOT NULL,
      pricing_value TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      costs_json TEXT NOT NULL,
      exchange_rates_json TEXT NOT NULL,
      pricing_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );
  `);

  return {
    list() {
      return db
        .prepare("SELECT * FROM costings ORDER BY updated_at DESC")
        .all()
        .map(rowToSavedCosting);
    },

    get(id) {
      const row = db.prepare("SELECT * FROM costings WHERE id = ?").get(id);
      return row ? rowToSavedCosting(row) : undefined;
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
        INSERT INTO costings (
          id,
          name,
          product,
          quantity_value,
          quantity_unit,
          incoterm,
          quotation_currency,
          usd_idr,
          pricing_type,
          pricing_value,
          status,
          created_at,
          updated_at,
          costs_json,
          exchange_rates_json,
          pricing_json,
          result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          product = excluded.product,
          quantity_value = excluded.quantity_value,
          quantity_unit = excluded.quantity_unit,
          incoterm = excluded.incoterm,
          quotation_currency = excluded.quotation_currency,
          usd_idr = excluded.usd_idr,
          pricing_type = excluded.pricing_type,
          pricing_value = excluded.pricing_value,
          status = excluded.status,
          updated_at = excluded.updated_at,
          costs_json = excluded.costs_json,
          exchange_rates_json = excluded.exchange_rates_json,
          pricing_json = excluded.pricing_json,
          result_json = excluded.result_json
      `).run(...savedCostingToParams(saved));

      return saved;
    },

    archive(id, now) {
      const existing = this.get(id);

      if (!existing) {
        return undefined;
      }

      db.prepare("UPDATE costings SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now, id);
      return this.get(id);
    },

    delete(id) {
      const result = db.prepare("DELETE FROM costings WHERE id = ?").run(id);
      return result.changes > 0;
    },

    close() {
      db.close();
    },
  };
}

function rowToSavedCosting(row) {
  return {
    id: row.id,
    name: row.name,
    product: row.product,
    quantity: {
      value: row.quantity_value,
      unit: row.quantity_unit,
    },
    incoterm: row.incoterm,
    quotationCurrency: row.quotation_currency,
    exchangeRates: JSON.parse(row.exchange_rates_json),
    costs: JSON.parse(row.costs_json),
    pricing: JSON.parse(row.pricing_json),
    result: JSON.parse(row.result_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function savedCostingToParams(saved) {
  return [
    saved.id,
    saved.name,
    saved.product,
    String(saved.quantity.value),
    saved.quantity.unit,
    saved.incoterm,
    saved.quotationCurrency,
    saved.exchangeRates.USD_IDR === undefined ? null : String(saved.exchangeRates.USD_IDR),
    saved.pricing.type,
    getPricingValue(saved.pricing),
    saved.status,
    saved.createdAt,
    saved.updatedAt,
    JSON.stringify(saved.costs),
    JSON.stringify(saved.exchangeRates),
    JSON.stringify(saved.pricing),
    JSON.stringify(saved.result),
  ];
}

function getPricingValue(pricing) {
  if (pricing.type === "MARGIN") {
    return String(pricing.targetMargin);
  }

  if (pricing.type === "MARKUP") {
    return String(pricing.markup);
  }

  return String(pricing.offerPricePerKg);
}
