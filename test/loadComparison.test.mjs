import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePacking,
  comparePackingAcrossContainers,
  containerSpecifications,
} from "../dist/domain/load/index.js";

function makeCargo(overrides = {}) {
  return {
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
    ...overrides,
  };
}

test("compares the same cargo across every built-in container", () => {
  const results = comparePackingAcrossContainers(makeCargo(), containerSpecifications);

  assert.deepEqual(
    results.map((result) => result.containerId),
    ["20ft-gp", "40ft-gp", "40ft-hc"],
  );
  assert.equal(results.length, containerSpecifications.length);
  assert.equal(results.every((result) => result.cartonsLoaded > 0), true);
});

test("comparison uses the same packing engine as a single-container result", () => {
  const cargo = makeCargo();
  const comparisons = comparePackingAcrossContainers(cargo, containerSpecifications);

  for (const container of containerSpecifications) {
    assert.deepEqual(
      comparisons.find((result) => result.containerId === container.id),
      calculatePacking(cargo, container),
    );
  }
});

test("includes non-fitting containers in the comparison results", () => {
  const results = comparePackingAcrossContainers(
    makeCargo({
      dimensions: {
        length: "300",
        width: "300",
        height: "300",
        unit: "CM",
      },
    }),
    containerSpecifications,
  );

  assert.equal(results.length, containerSpecifications.length);
  assert.equal(results.every((result) => result.cartonsLoaded === 0), true);
  assert.equal(results.every((result) => result.reason === "CARGO_DIMENSIONS_EXCEED_CONTAINER"), true);
});
