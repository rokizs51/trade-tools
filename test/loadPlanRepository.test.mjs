import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSqliteLoadPlanRepository } from "../scripts/sqliteLoadPlanRepository.mjs";
import { createDuplicateLoadPlanDraft } from "../dist/domain/load/index.js";

const cargoInput = {
  productName: "Coconut Briquette",
  dimensions: {
    length: "60",
    width: "40",
    height: "30",
    unit: "CM",
  },
  grossWeight: {
    value: "20",
    unit: "KG",
  },
  unitsPerCarton: "12",
};

const result = {
  containerId: "40ft-hc",
  containerName: "40FT High Cube",
  cartonsLoaded: 840,
  totalUnits: 10080,
  totalCargoWeightKg: 16800,
  cargoVolumeM3: 60.48,
  containerVolumeM3: 76.352032,
  volumeUtilizationPercent: 79.212678,
  payloadUtilizationPercent: 63.063063,
  limitingFactor: "SPACE",
  orientation: { lengthMm: 600, widthMm: 300, heightMm: 400 },
  grid: { x: 20, y: 7, z: 6 },
  unusedSpace: { lengthMm: 32, widthMm: 252, heightMm: 298 },
  orientationResults: [],
};

function withRepository(run) {
  const dir = mkdtempSync(join(tmpdir(), "trade-tools-load-plans-"));
  const repository = createSqliteLoadPlanRepository(join(dir, "trade-tools.sqlite"));

  try {
    run(repository);
  } finally {
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeDraft(overrides = {}) {
  return {
    name: "Coconut 40HC Sep",
    cargoInput,
    containerId: "40ft-hc",
    loadingMode: "FLOOR_LOADED",
    result,
    comparisons: [result],
    ...overrides,
  };
}

test("sqlite repository saves and lists load plans", () => {
  withRepository((repository) => {
    const saved = repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "load-plan-1",
    });

    assert.equal(saved.id, "load-plan-1");
    assert.equal(saved.status, "ACTIVE");
    assert.equal(saved.createdAt, "2026-09-01T04:00:00.000Z");
    assert.equal(repository.list().length, 1);
    assert.equal(repository.list()[0].cargoInput.productName, "Coconut Briquette");
    assert.equal(repository.list()[0].result.cartonsLoaded, 840);
  });
});

test("sqlite repository reopens and updates existing load plans", () => {
  withRepository((repository) => {
    repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "load-plan-1",
    });

    repository.save(makeDraft({ name: "Updated Coconut 40HC" }), {
      existingId: "load-plan-1",
      now: "2026-09-01T05:00:00.000Z",
      createId: () => "unused",
    });

    const reopened = repository.get("load-plan-1");

    assert.equal(reopened?.name, "Updated Coconut 40HC");
    assert.equal(reopened?.createdAt, "2026-09-01T04:00:00.000Z");
    assert.equal(reopened?.updatedAt, "2026-09-01T05:00:00.000Z");
    assert.equal(repository.list().length, 1);
  });
});

test("sqlite repository deletes load plans permanently", () => {
  withRepository((repository) => {
    repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "load-plan-1",
    });

    assert.equal(repository.delete("load-plan-1"), true);
    assert.equal(repository.get("load-plan-1"), undefined);
    assert.equal(repository.list().length, 0);
  });
});

test("sqlite repository archives load plans without deleting", () => {
  withRepository((repository) => {
    repository.save(makeDraft(), {
      now: "2026-09-01T04:00:00.000Z",
      createId: () => "load-plan-1",
    });

    const archived = repository.archive("load-plan-1", "2026-09-01T06:00:00.000Z");

    assert.equal(archived?.status, "ARCHIVED");
    assert.equal(repository.get("load-plan-1")?.name, "Coconut 40HC Sep");
    assert.equal(repository.get("load-plan-1")?.updatedAt, "2026-09-01T06:00:00.000Z");
  });
});

test("sqlite repository reports false when deleting a missing load plan", () => {
  withRepository((repository) => {
    assert.equal(repository.delete("missing-load-plan"), false);
  });
});

test("duplicate load plan draft copies a plan without id or timestamps", () => {
  const draft = createDuplicateLoadPlanDraft({
    ...makeDraft(),
    id: "load-plan-1",
    status: "ACTIVE",
    createdAt: "2026-09-01T04:00:00.000Z",
    updatedAt: "2026-09-01T05:00:00.000Z",
  });

  assert.equal(draft.name, "Coconut 40HC Sep Copy");
  assert.equal("id" in draft, false);
  assert.equal("createdAt" in draft, false);
  assert.deepEqual(draft.result, result);
});
