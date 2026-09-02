import { Decimal } from "../costing/decimal.js";
import {
  LoadCalculationError,
  type CargoInput,
  type ContainerSpecification,
  type DecimalInput,
  type DimensionUnit,
  type NormalizedCargo,
  type WeightUnit,
} from "./types.js";

const MILLIMETERS_PER_INCH = Decimal.from("25.4");
const KILOGRAMS_PER_POUND = Decimal.from("0.45359237");

export function normalizeCargo(input: CargoInput): NormalizedCargo {
  const lengthMm = convertDimensionToMillimeters(input.dimensions.length, input.dimensions.unit);
  const widthMm = convertDimensionToMillimeters(input.dimensions.width, input.dimensions.unit);
  const heightMm = convertDimensionToMillimeters(input.dimensions.height, input.dimensions.unit);
  const grossWeightKg = convertWeightToKilograms(input.grossWeight.value, input.grossWeight.unit);
  const unitsPerCarton = parsePositiveInteger(input.unitsPerCarton);

  return {
    ...(input.productName ? { productName: input.productName } : {}),
    dimensions: {
      lengthMm,
      widthMm,
      heightMm,
    },
    grossWeightKg,
    unitsPerCarton,
  };
}

export function validateContainerSpecification(container: ContainerSpecification | undefined): ContainerSpecification {
  if (!container) {
    throw new LoadCalculationError("INVALID_CONTAINER", "Select a container.");
  }

  const dimensions = [
    container.internalLengthMm,
    container.internalWidthMm,
    container.internalHeightMm,
    container.maxPayloadKg,
  ];

  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new LoadCalculationError("INVALID_CONTAINER", "Container dimensions and payload must be greater than zero.");
  }

  return container;
}

export function convertDimensionToMillimeters(value: DecimalInput, unit: DimensionUnit): number {
  const amount = parsePositiveDecimal(value, "INVALID_DIMENSION", "Carton dimensions must be greater than zero.");

  if (unit === "MM") {
    return decimalToFiniteNumber(amount);
  }

  if (unit === "CM") {
    return decimalToFiniteNumber(amount.multiply(Decimal.from("10")));
  }

  return decimalToFiniteNumber(amount.multiply(MILLIMETERS_PER_INCH));
}

export function convertWeightToKilograms(value: DecimalInput, unit: WeightUnit): number {
  const amount = parsePositiveDecimal(value, "INVALID_WEIGHT", "Carton gross weight must be greater than zero.");

  if (unit === "KG") {
    return decimalToFiniteNumber(amount);
  }

  return decimalToFiniteNumber(amount.multiply(KILOGRAMS_PER_POUND));
}

function parsePositiveInteger(value: DecimalInput): number {
  const amount = parsePositiveDecimal(
    value,
    "INVALID_UNITS_PER_CARTON",
    "Units per carton must be one or greater.",
  );
  const parsed = decimalToFiniteNumber(amount);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new LoadCalculationError("INVALID_UNITS_PER_CARTON", "Units per carton must be a whole number.");
  }

  return parsed;
}

function parsePositiveDecimal(
  value: DecimalInput,
  code: "INVALID_DIMENSION" | "INVALID_WEIGHT" | "INVALID_UNITS_PER_CARTON",
  message: string,
): Decimal {
  try {
    const decimal = Decimal.from(value);

    if (!decimal.isPositive()) {
      throw new LoadCalculationError(code, message);
    }

    return decimal;
  } catch (error) {
    if (error instanceof LoadCalculationError) {
      throw error;
    }

    throw new LoadCalculationError(code, message);
  }
}

function decimalToFiniteNumber(value: Decimal): number {
  const numberValue = Number(value.toString());

  if (!Number.isFinite(numberValue)) {
    throw new LoadCalculationError("INVALID_DIMENSION", "Converted load value is too large.");
  }

  return numberValue;
}
