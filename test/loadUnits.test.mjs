import assert from "node:assert/strict";
import test from "node:test";

import {
  LoadCalculationError,
  containerSpecifications,
  convertDimensionToMillimeters,
  convertWeightToKilograms,
  getContainerSpecification,
  normalizeCargo,
  validateContainerSpecification,
} from "../dist/domain/load/index.js";

test("provides the initial built-in container presets", () => {
  assert.equal(containerSpecifications.length, 3);
  assert.deepEqual(
    containerSpecifications.map((container) => container.id),
    ["20ft-gp", "40ft-gp", "40ft-hc"],
  );

  const highCube = getContainerSpecification("40ft-hc");

  assert.equal(highCube?.name, "40FT High Cube");
  assert.equal(highCube?.internalLengthMm, 12032);
  assert.equal(highCube?.internalWidthMm, 2352);
  assert.equal(highCube?.internalHeightMm, 2698);
  assert.equal(highCube?.maxPayloadKg, 26640);
});

test("converts dimensions to millimeters", () => {
  assert.equal(convertDimensionToMillimeters("600", "MM"), 600);
  assert.equal(convertDimensionToMillimeters("60", "CM"), 600);
  assert.equal(convertDimensionToMillimeters("10", "IN"), 254);
  assert.equal(convertDimensionToMillimeters("2.5", "CM"), 25);
});

test("converts weights to kilograms", () => {
  assert.equal(convertWeightToKilograms("20", "KG"), 20);
  assert.equal(convertWeightToKilograms("10", "LB"), 4.5359237);
});

test("normalizes cargo input", () => {
  const cargo = normalizeCargo({
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
  });

  assert.deepEqual(cargo, {
    productName: "Coconut Briquette",
    dimensions: {
      lengthMm: 600,
      widthMm: 400,
      heightMm: 300,
    },
    grossWeightKg: 20,
    unitsPerCarton: 12,
  });
});

test("rejects invalid cargo dimensions", () => {
  assert.throws(
    () => convertDimensionToMillimeters("0", "CM"),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_DIMENSION",
  );

  assert.throws(
    () => convertDimensionToMillimeters("-1", "CM"),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_DIMENSION",
  );

  assert.throws(
    () => convertDimensionToMillimeters("abc", "CM"),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_DIMENSION",
  );
});

test("rejects invalid cargo weight", () => {
  assert.throws(
    () => convertWeightToKilograms("0", "KG"),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_WEIGHT",
  );

  assert.throws(
    () => convertWeightToKilograms("-1", "LB"),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_WEIGHT",
  );
});

test("rejects invalid units per carton", () => {
  assert.throws(
    () =>
      normalizeCargo({
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
        unitsPerCarton: "0",
      }),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_UNITS_PER_CARTON",
  );

  assert.throws(
    () =>
      normalizeCargo({
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
        unitsPerCarton: "1.5",
      }),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_UNITS_PER_CARTON",
  );
});

test("validates container specifications", () => {
  assert.equal(validateContainerSpecification(getContainerSpecification("20ft-gp")).id, "20ft-gp");

  assert.throws(
    () => validateContainerSpecification(undefined),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_CONTAINER",
  );

  assert.throws(
    () =>
      validateContainerSpecification({
        id: "bad-container",
        name: "Bad Container",
        internalLengthMm: 0,
        internalWidthMm: 2352,
        internalHeightMm: 2393,
        maxPayloadKg: 28230,
      }),
    (error) => error instanceof LoadCalculationError && error.code === "INVALID_CONTAINER",
  );
});
