import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  LoadCalculationError,
  calculatePacking,
  comparePackingAcrossContainers,
  containerSpecifications,
  getContainerSpecification,
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

test("matches the PRD coconut exporter scenario with current 40FT High Cube preset", () => {
  const result = calculatePacking(makeCargo(), getContainerSpecification("40ft-hc"));

  assert.equal(result.containerName, "40FT High Cube");
  assert.equal(result.cartonsLoaded, 840);
  assert.equal(result.totalUnits, 10080);
  assert.equal(result.totalCargoWeightKg, 16800);
  assert.equal(result.cargoVolumeM3, 60.48);
  assert.equal(result.volumeUtilizationPercent, 79.212678);
  assert.equal(result.payloadUtilizationPercent, 63.063063);
  assert.equal(result.limitingFactor, "SPACE");
  assert.deepEqual(result.orientation, { lengthMm: 600, widthMm: 300, heightMm: 400 });
  assert.deepEqual(result.grid, { x: 20, y: 7, z: 6 });
  assert.equal(result.reason, undefined);
});

test("compares PRD cargo across all MVP container presets", () => {
  const results = comparePackingAcrossContainers(makeCargo(), containerSpecifications);

  assert.deepEqual(
    results.map((result) => ({
      containerId: result.containerId,
      cartonsLoaded: result.cartonsLoaded,
      totalUnits: result.totalUnits,
      limitingFactor: result.limitingFactor,
    })),
    [
      { containerId: "20ft-gp", cartonsLoaded: 315, totalUnits: 3780, limitingFactor: "SPACE" },
      { containerId: "40ft-gp", cartonsLoaded: 700, totalUnits: 8400, limitingFactor: "SPACE" },
      { containerId: "40ft-hc", cartonsLoaded: 840, totalUnits: 10080, limitingFactor: "SPACE" },
    ],
  );
});

test("handles very small cartons without broken numeric output", () => {
  const result = calculatePacking(
    makeCargo({
      dimensions: {
        length: "5",
        width: "5",
        height: "5",
        unit: "CM",
      },
      grossWeight: {
        value: "0.05",
        unit: "KG",
      },
      unitsPerCarton: "1",
    }),
    getContainerSpecification("40ft-hc"),
  );

  assert.equal(result.cartonsLoaded > 5000, true);
  assertNoBrokenNumbers(result);
});

test("handles very large cartons as a non-fitting result", () => {
  const result = calculatePacking(
    makeCargo({
      dimensions: {
        length: "300",
        width: "300",
        height: "300",
        unit: "CM",
      },
    }),
    getContainerSpecification("40ft-hc"),
  );

  assert.equal(result.cartonsLoaded, 0);
  assert.equal(result.reason, "CARGO_DIMENSIONS_EXCEED_CONTAINER");
  assertNoBrokenNumbers(result);
});

test("handles very heavy cartons as a payload failure", () => {
  const result = calculatePacking(
    makeCargo({
      grossWeight: {
        value: "30000",
        unit: "KG",
      },
    }),
    getContainerSpecification("40ft-hc"),
  );

  assert.equal(result.cartonsLoaded, 0);
  assert.equal(result.reason, "CARGO_WEIGHT_EXCEEDS_PAYLOAD");
  assertNoBrokenNumbers(result);
});

test("rejects zero, negative, missing, and fractional unit inputs", () => {
  const container = getContainerSpecification("40ft-hc");

  assert.throws(
    () => calculatePacking(makeCargo({ dimensions: { length: "0", width: "40", height: "30", unit: "CM" } }), container),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_DIMENSION",
  );
  assert.throws(
    () => calculatePacking(makeCargo({ grossWeight: { value: "-1", unit: "KG" } }), container),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_WEIGHT",
  );
  assert.throws(
    () => calculatePacking(makeCargo({ unitsPerCarton: "" }), container),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_UNITS_PER_CARTON",
  );
  assert.throws(
    () => calculatePacking(makeCargo({ unitsPerCarton: "1.5" }), container),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_UNITS_PER_CARTON",
  );
});

test("calculates all built-in container comparisons quickly", () => {
  const start = performance.now();
  const results = comparePackingAcrossContainers(makeCargo(), containerSpecifications);
  const elapsedMs = performance.now() - start;

  assert.equal(results.length, 3);
  assert.equal(elapsedMs < 100, true);
});

function assertNoBrokenNumbers(result) {
  const numbers = [
    result.cartonsLoaded,
    result.totalUnits,
    result.totalCargoWeightKg,
    result.cargoVolumeM3,
    result.containerVolumeM3,
    result.volumeUtilizationPercent,
    result.payloadUtilizationPercent,
    result.grid.x,
    result.grid.y,
    result.grid.z,
    result.unusedSpace.lengthMm,
    result.unusedSpace.widthMm,
    result.unusedSpace.heightMm,
    ...result.orientationResults.flatMap((orientationResult) => [
      orientationResult.spatialCapacity,
      orientationResult.weightCapacity,
      orientationResult.usableCapacity,
      orientationResult.grid.x,
      orientationResult.grid.y,
      orientationResult.grid.z,
    ]),
  ];

  assert.equal(numbers.every(Number.isFinite), true);
}
