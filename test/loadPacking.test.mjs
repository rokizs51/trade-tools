import assert from "node:assert/strict";
import test from "node:test";

import {
  LoadCalculationError,
  calculatePacking,
  calculateSpatialGrid,
  calculateWeightCapacity,
  generateCartonOrientations,
} from "../dist/domain/load/index.js";

const perfectFitContainer = {
  id: "test-perfect",
  name: "Perfect Fit Container",
  internalLengthMm: 6000,
  internalWidthMm: 4000,
  internalHeightMm: 3000,
  maxPayloadKg: 20000,
};

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

test("generates six unique orientations for a rectangular carton", () => {
  const orientations = generateCartonOrientations({
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
  });

  assert.deepEqual(orientations, [
    { lengthMm: 600, widthMm: 400, heightMm: 300 },
    { lengthMm: 600, widthMm: 300, heightMm: 400 },
    { lengthMm: 400, widthMm: 600, heightMm: 300 },
    { lengthMm: 400, widthMm: 300, heightMm: 600 },
    { lengthMm: 300, widthMm: 600, heightMm: 400 },
    { lengthMm: 300, widthMm: 400, heightMm: 600 },
  ]);
});

test("removes duplicate orientations", () => {
  assert.deepEqual(generateCartonOrientations({ lengthMm: 500, widthMm: 500, heightMm: 500 }), [
    { lengthMm: 500, widthMm: 500, heightMm: 500 },
  ]);

  assert.equal(generateCartonOrientations({ lengthMm: 600, widthMm: 400, heightMm: 400 }).length, 3);
});

test("calculates spatial grid for one orientation", () => {
  assert.deepEqual(
    calculateSpatialGrid(perfectFitContainer, { lengthMm: 600, widthMm: 400, heightMm: 300 }),
    { x: 10, y: 10, z: 10 },
  );
});

test("calculates weight capacity", () => {
  assert.equal(
    calculateWeightCapacity(
      {
        productName: "Coconut Briquette",
        dimensions: { lengthMm: 600, widthMm: 400, heightMm: 300 },
        grossWeightKg: 20,
        unitsPerCarton: 12,
      },
      perfectFitContainer,
    ),
    1000,
  );
});

test("calculates perfect fit capacity", () => {
  const result = calculatePacking(makeCargo(), perfectFitContainer);

  assert.equal(result.cartonsLoaded, 1000);
  assert.equal(result.totalUnits, 12000);
  assert.equal(result.totalCargoWeightKg, 20000);
  assert.equal(result.cargoVolumeM3, 72);
  assert.equal(result.containerVolumeM3, 72);
  assert.equal(result.volumeUtilizationPercent, 100);
  assert.equal(result.payloadUtilizationPercent, 100);
  assert.equal(result.limitingFactor, "EQUAL");
  assert.deepEqual(result.orientation, { lengthMm: 600, widthMm: 400, heightMm: 300 });
  assert.deepEqual(result.grid, { x: 10, y: 10, z: 10 });
  assert.deepEqual(result.unusedSpace, { lengthMm: 0, widthMm: 0, heightMm: 0 });
  assert.equal(result.reason, undefined);
});

test("selects the best usable orientation", () => {
  const container = {
    id: "orientation-test",
    name: "Orientation Test",
    internalLengthMm: 900,
    internalWidthMm: 1200,
    internalHeightMm: 1500,
    maxPayloadKg: 40000,
  };
  const result = calculatePacking(makeCargo(), container);

  assert.equal(result.cartonsLoaded, 20);
  assert.deepEqual(result.orientation, { lengthMm: 400, widthMm: 600, heightMm: 300 });
  assert.deepEqual(result.grid, { x: 2, y: 2, z: 5 });
  assert.equal(result.limitingFactor, "SPACE");
});

test("returns a space-limited result", () => {
  const container = {
    id: "space-limited",
    name: "Space Limited",
    internalLengthMm: 3000,
    internalWidthMm: 2000,
    internalHeightMm: 1500,
    maxPayloadKg: 20000,
  };
  const result = calculatePacking(makeCargo(), container);

  assert.equal(result.cartonsLoaded, 125);
  assert.equal(result.limitingFactor, "SPACE");
  assert.equal(result.reason, undefined);
});

test("returns a weight-limited result", () => {
  const result = calculatePacking(makeCargo(), {
    ...perfectFitContainer,
    maxPayloadKg: 10000,
  });

  assert.equal(result.cartonsLoaded, 500);
  assert.equal(result.totalCargoWeightKg, 10000);
  assert.equal(result.payloadUtilizationPercent, 100);
  assert.equal(result.limitingFactor, "WEIGHT");
});

test("returns cargo-too-large result without throwing", () => {
  const result = calculatePacking(
    makeCargo({
      dimensions: {
        length: "300",
        width: "300",
        height: "300",
        unit: "CM",
      },
    }),
    {
      id: "too-small",
      name: "Too Small",
      internalLengthMm: 2000,
      internalWidthMm: 2350,
      internalHeightMm: 2400,
      maxPayloadKg: 20000,
    },
  );

  assert.equal(result.cartonsLoaded, 0);
  assert.equal(result.totalUnits, 0);
  assert.equal(result.totalCargoWeightKg, 0);
  assert.equal(result.cargoVolumeM3, 0);
  assert.equal(result.volumeUtilizationPercent, 0);
  assert.equal(result.payloadUtilizationPercent, 0);
  assert.equal(result.limitingFactor, "SPACE");
  assert.equal(result.reason, "CARGO_DIMENSIONS_EXCEED_CONTAINER");
});

test("returns cargo-too-heavy result without throwing", () => {
  const result = calculatePacking(
    makeCargo({
      grossWeight: {
        value: "25000",
        unit: "KG",
      },
    }),
    {
      ...perfectFitContainer,
      maxPayloadKg: 20000,
    },
  );

  assert.equal(result.cartonsLoaded, 0);
  assert.equal(result.limitingFactor, "WEIGHT");
  assert.equal(result.reason, "CARGO_WEIGHT_EXCEEDS_PAYLOAD");
});

test("rejects invalid inputs through the packing engine", () => {
  assert.throws(
    () => calculatePacking(makeCargo({ unitsPerCarton: "0" }), perfectFitContainer),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_UNITS_PER_CARTON",
  );

  assert.throws(
    () => calculatePacking(makeCargo(), undefined),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_CONTAINER",
  );
});

test("does not return broken numeric output", () => {
  const result = calculatePacking(makeCargo(), perfectFitContainer);
  const numericValues = [
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
  ];

  assert.equal(numericValues.every(Number.isFinite), true);
});
