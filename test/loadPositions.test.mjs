import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePacking,
  filterCargoPositionsByLayer,
  generateCargoPositions,
  getCargoLayers,
  getPackingLayers,
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

test("generates one position per loaded carton for a full grid", () => {
  const result = calculatePacking(makeCargo(), perfectFitContainer);
  const positions = generateCargoPositions(result);

  assert.equal(positions.length, result.cartonsLoaded);
  assert.deepEqual(positions[0], {
    id: "carton-1",
    x: 0,
    y: 0,
    z: 0,
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    layer: 1,
  });
  assert.deepEqual(positions[1], {
    id: "carton-2",
    x: 600,
    y: 0,
    z: 0,
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    layer: 1,
  });
  assert.deepEqual(positions.at(-1), {
    id: "carton-1000",
    x: 5400,
    y: 3600,
    z: 2700,
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    layer: 10,
  });
});

test("keeps every generated carton inside container bounds", () => {
  const result = calculatePacking(makeCargo(), perfectFitContainer);
  const positions = generateCargoPositions(result);

  for (const position of positions) {
    assert.equal(position.x >= 0, true);
    assert.equal(position.y >= 0, true);
    assert.equal(position.z >= 0, true);
    assert.equal(position.x + position.lengthMm <= perfectFitContainer.internalLengthMm, true);
    assert.equal(position.y + position.widthMm <= perfectFitContainer.internalWidthMm, true);
    assert.equal(position.z + position.heightMm <= perfectFitContainer.internalHeightMm, true);
  }
});

test("does not generate overlapping positions in the grid", () => {
  const result = calculatePacking(makeCargo(), perfectFitContainer);
  const positions = generateCargoPositions(result);
  const occupied = new Set();

  for (const position of positions) {
    const key = `${position.x}:${position.y}:${position.z}`;

    assert.equal(occupied.has(key), false);
    occupied.add(key);
  }
});

test("supports partial final layer for weight-limited loads", () => {
  const result = calculatePacking(makeCargo(), {
    ...perfectFitContainer,
    maxPayloadKg: 10500,
  });
  const positions = generateCargoPositions(result);
  const layers = getCargoLayers(positions);

  assert.equal(result.cartonsLoaded, 525);
  assert.equal(positions.length, 525);
  assert.deepEqual(layers, [
    { layer: 1, cartonCount: 100 },
    { layer: 2, cartonCount: 100 },
    { layer: 3, cartonCount: 100 },
    { layer: 4, cartonCount: 100 },
    { layer: 5, cartonCount: 100 },
    { layer: 6, cartonCount: 25 },
  ]);
  assert.deepEqual(positions.at(-1), {
    id: "carton-525",
    x: 2400,
    y: 800,
    z: 1500,
    lengthMm: 600,
    widthMm: 400,
    heightMm: 300,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    layer: 6,
  });
});

test("summarizes packing layers without generating positions", () => {
  const result = calculatePacking(makeCargo(), {
    ...perfectFitContainer,
    maxPayloadKg: 10500,
  });

  assert.deepEqual(getPackingLayers(result), [
    { layer: 1, cartonCount: 100 },
    { layer: 2, cartonCount: 100 },
    { layer: 3, cartonCount: 100 },
    { layer: 4, cartonCount: 100 },
    { layer: 5, cartonCount: 100 },
    { layer: 6, cartonCount: 25 },
  ]);
});

test("filters positions by layer", () => {
  const result = calculatePacking(makeCargo(), {
    ...perfectFitContainer,
    maxPayloadKg: 10500,
  });
  const positions = generateCargoPositions(result);

  assert.equal(filterCargoPositionsByLayer(positions, "ALL").length, 525);
  assert.equal(filterCargoPositionsByLayer(positions, 1).length, 100);
  assert.equal(filterCargoPositionsByLayer(positions, 6).length, 25);
  assert.equal(filterCargoPositionsByLayer(positions, 7).length, 0);
});

test("returns no positions for zero-capacity results", () => {
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

  assert.deepEqual(generateCargoPositions(result), []);
  assert.deepEqual(getCargoLayers([]), []);
});
