import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePacking,
  createLoadCostingSeed,
  getContainerSpecification,
} from "../dist/domain/load/index.js";

test("creates a costing seed from a selected load result", () => {
  const result = calculatePacking(
    {
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
    },
    getContainerSpecification("40ft-hc"),
  );

  assert.deepEqual(createLoadCostingSeed(result, "Coconut Briquette"), {
    costingName: "Coconut Briquette 40FT High Cube",
    product: "Coconut Briquette",
    quantityKg: "16800",
    note: "40FT High Cube: 840 cartons / 10080 units.",
  });
});

test("keeps unnamed products empty for the costing product field", () => {
  const result = calculatePacking(
    {
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
    },
    getContainerSpecification("20ft-gp"),
  );

  const seed = createLoadCostingSeed(result, " ");

  assert.equal(seed.costingName, "Untitled product 20FT General Purpose");
  assert.equal(seed.product, "");
  assert.equal(seed.quantityKg, "6300");
});
