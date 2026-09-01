import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveCosting,
  createDuplicateDraft,
  deleteCosting,
  getSavedCosting,
  listSavedCostings,
  saveCosting,
} from "../dist/domain/costing/index.js";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

const resultSnapshot = {
  currency: "USD",
  quantity: { value: "25000", unit: "KG" },
  selectedIncoterm: "CIF",
  selectedTotalCost: "12802.727272727273",
  selectedCostPerKg: "0.512109090909",
  stageTotals: {
    exw: "10454.545454545454",
    fob: "11272.727272727272",
    cfr: "12722.727272727272",
    cif: "12802.727272727272",
  },
  stageUnitCosts: {
    exwPerKg: "0.418181818182",
    fobPerKg: "0.450909090909",
    cfrPerKg: "0.508909090909",
    cifPerKg: "0.512109090909",
  },
  pricing: {
    breakEvenPricePerKg: "0.512109090909",
    sellingPricePerKg: "0.640136363636",
    revenue: "16003.4090909",
    profit: "3200.681818172727",
    margin: "0.2",
    markup: "0.25",
    isBelowBreakEven: false,
  },
};

function makeDraft(overrides = {}) {
  return {
    name: "Coconut UAE Sep",
    product: "Semi-Husked Coconut",
    quantity: { value: "25000", unit: "KG" },
    incoterm: "CIF",
    quotationCurrency: "USD",
    exchangeRates: { USD_IDR: "16500" },
    costs: [
      { name: "Product", amount: "162500000", currency: "IDR", stage: "EXW" },
      { name: "Freight", amount: "1450", currency: "USD", stage: "CFR" },
    ],
    pricing: { type: "MARGIN", targetMargin: "0.20" },
    result: resultSnapshot,
    ...overrides,
  };
}

test("saves a costing with header, exchange rate, costs, pricing, result snapshot, and timestamps", () => {
  const storage = new MemoryStorage();

  const saved = saveCosting(storage, makeDraft(), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-1",
  });

  assert.equal(saved.id, "costing-1");
  assert.equal(saved.status, "ACTIVE");
  assert.equal(saved.name, "Coconut UAE Sep");
  assert.equal(saved.exchangeRates.USD_IDR, "16500");
  assert.equal(saved.costs.length, 2);
  assert.equal(saved.pricing.type, "MARGIN");
  assert.equal(saved.result.pricing.sellingPricePerKg, "0.640136363636");
  assert.equal(saved.createdAt, "2026-09-01T04:00:00.000Z");
  assert.equal(saved.updatedAt, "2026-09-01T04:00:00.000Z");
});

test("reopens a saved costing by id", () => {
  const storage = new MemoryStorage();

  saveCosting(storage, makeDraft(), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-1",
  });

  const saved = getSavedCosting(storage, "costing-1");

  assert.equal(saved?.product, "Semi-Husked Coconut");
  assert.equal(saved?.quantity.value, "25000");
  assert.equal(saved?.incoterm, "CIF");
  assert.equal(saved?.exchangeRates.USD_IDR, "16500");
});

test("updates an existing costing without changing its created date", () => {
  const storage = new MemoryStorage();

  saveCosting(storage, makeDraft(), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-1",
  });

  const updated = saveCosting(storage, makeDraft({ exchangeRates: { USD_IDR: "17000" } }), {
    existingId: "costing-1",
    now: "2026-09-01T05:00:00.000Z",
    createId: () => "unused",
  });

  assert.equal(updated.id, "costing-1");
  assert.equal(updated.exchangeRates.USD_IDR, "17000");
  assert.equal(updated.createdAt, "2026-09-01T04:00:00.000Z");
  assert.equal(updated.updatedAt, "2026-09-01T05:00:00.000Z");
  assert.equal(listSavedCostings(storage).length, 1);
});

test("keeps historical saved exchange rates independent from later saves", () => {
  const storage = new MemoryStorage();

  saveCosting(storage, makeDraft({ name: "Old FX", exchangeRates: { USD_IDR: "16500" } }), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-old",
  });
  saveCosting(storage, makeDraft({ name: "New FX", exchangeRates: { USD_IDR: "17500" } }), {
    now: "2026-09-01T05:00:00.000Z",
    createId: () => "costing-new",
  });

  assert.equal(getSavedCosting(storage, "costing-old")?.exchangeRates.USD_IDR, "16500");
  assert.equal(getSavedCosting(storage, "costing-new")?.exchangeRates.USD_IDR, "17500");
});

test("archives a costing without deleting its saved data", () => {
  const storage = new MemoryStorage();

  saveCosting(storage, makeDraft(), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-1",
  });

  const archived = archiveCosting(storage, "costing-1", "2026-09-01T06:00:00.000Z");

  assert.equal(archived?.status, "ARCHIVED");
  assert.equal(archived?.updatedAt, "2026-09-01T06:00:00.000Z");
  assert.equal(getSavedCosting(storage, "costing-1")?.name, "Coconut UAE Sep");
  assert.equal(getSavedCosting(storage, "costing-1")?.status, "ARCHIVED");
});

test("deletes a costing permanently", () => {
  const storage = new MemoryStorage();

  saveCosting(storage, makeDraft(), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-1",
  });

  const deleted = deleteCosting(storage, "costing-1");

  assert.equal(deleted, true);
  assert.equal(getSavedCosting(storage, "costing-1"), undefined);
  assert.equal(listSavedCostings(storage).length, 0);
});

test("delete reports false when the costing does not exist", () => {
  const storage = new MemoryStorage();

  const deleted = deleteCosting(storage, "missing-costing");

  assert.equal(deleted, false);
  assert.equal(listSavedCostings(storage).length, 0);
});

test("duplicate draft copies a costing without id, status, or timestamps", () => {
  const storage = new MemoryStorage();
  const saved = saveCosting(storage, makeDraft(), {
    now: "2026-09-01T04:00:00.000Z",
    createId: () => "costing-1",
  });

  const duplicate = createDuplicateDraft(saved);

  assert.equal(duplicate.name, "Coconut UAE Sep Copy");
  assert.equal(duplicate.product, "Semi-Husked Coconut");
  assert.equal(duplicate.exchangeRates.USD_IDR, "16500");
  assert.equal(duplicate.costs.length, 2);
  assert.equal(duplicate.result.pricing.sellingPricePerKg, "0.640136363636");
  assert.equal("id" in duplicate, false);
  assert.equal("status" in duplicate, false);
  assert.equal("createdAt" in duplicate, false);
  assert.equal("updatedAt" in duplicate, false);
});

test("ignores corrupted saved costing storage", () => {
  const storage = new MemoryStorage();
  storage.setItem("export-cost-calculator.costings.v1", "not-json");

  assert.deepEqual(listSavedCostings(storage), []);
});
