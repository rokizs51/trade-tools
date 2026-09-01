import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSqliteCostingRepository } from "../scripts/sqliteCostingRepository.mjs";

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

function withRepository(run) {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-sqlite-"));
  const repository = createSqliteCostingRepository(join(dir, "costings.sqlite"));

  try {
    run(repository);
  } finally {
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeDraft(overrides = {}) {
  return {
    name: "Coconut UAE Sep",
    product: "Semi-Husked Coconut",
    quantity: { value: "25000", unit: "KG" },
    incoterm: "CIF",
    quotationCurrency: "USD",
    exchangeRates: { USD_IDR: "16500" },
    costs: [
      { id: "product-cost", name: "Product", amount: "162500000", currency: "IDR", stage: "EXW" },
      { id: "freight-cost", name: "Freight", amount: "1450", currency: "USD", stage: "CFR" },
    ],
    pricing: { type: "MARGIN", targetMargin: "0.20" },
    result: resultSnapshot,
    ...overrides,
  };
}

test("sqlite repository saves and lists costings", () => {
  withRepository((repository) => {
    const saved = repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "costing-1",
    });

    assert.equal(saved.id, "costing-1");
    assert.equal(saved.status, "ACTIVE");
    assert.equal(repository.list().length, 1);
    assert.equal(repository.list()[0].exchangeRates.USD_IDR, "16500");
    assert.equal(repository.list()[0].result.pricing.sellingPricePerKg, "0.640136363636");
  });
});

test("sqlite repository reopens and updates existing costings", () => {
  withRepository((repository) => {
    repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "costing-1",
    });

    repository.save(makeDraft({ exchangeRates: { USD_IDR: "17000" } }), {
      existingId: "costing-1",
      now: "2026-09-01T05:00:00.000Z",
      createId: () => "unused",
    });

    const reopened = repository.get("costing-1");

    assert.equal(reopened?.exchangeRates.USD_IDR, "17000");
    assert.equal(reopened?.createdAt, "2026-09-01T04:00:00.000Z");
    assert.equal(reopened?.updatedAt, "2026-09-01T05:00:00.000Z");
    assert.equal(repository.list().length, 1);
  });
});

test("sqlite repository archives without deleting", () => {
  withRepository((repository) => {
    repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "costing-1",
    });

    const archived = repository.archive("costing-1", "2026-09-01T06:00:00.000Z");

    assert.equal(archived?.status, "ARCHIVED");
    assert.equal(repository.get("costing-1")?.name, "Coconut UAE Sep");
    assert.equal(repository.get("costing-1")?.status, "ARCHIVED");
  });
});

test("sqlite repository deletes costings permanently", () => {
  withRepository((repository) => {
    repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "costing-1",
    });

    assert.equal(repository.delete("costing-1"), true);
    assert.equal(repository.get("costing-1"), undefined);
    assert.equal(repository.list().length, 0);
  });
});

test("sqlite repository reports false when deleting a missing costing", () => {
  withRepository((repository) => {
    assert.equal(repository.delete("missing-costing"), false);
  });
});
