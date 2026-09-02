export type DecimalInput = string | number;

export type DimensionUnit = "MM" | "CM" | "IN";

export type WeightUnit = "KG" | "LB";

export interface CargoDimensionsInput {
  length: DecimalInput;
  width: DecimalInput;
  height: DecimalInput;
  unit: DimensionUnit;
}

export interface CargoWeightInput {
  value: DecimalInput;
  unit: WeightUnit;
}

export interface CargoInput {
  productName?: string;
  dimensions: CargoDimensionsInput;
  grossWeight: CargoWeightInput;
  unitsPerCarton: DecimalInput;
}

export interface NormalizedCargo {
  productName?: string;
  dimensions: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  };
  grossWeightKg: number;
  unitsPerCarton: number;
}

export interface ContainerSpecification {
  id: string;
  name: string;
  internalLengthMm: number;
  internalWidthMm: number;
  internalHeightMm: number;
  maxPayloadKg: number;
  tareWeightKg?: number;
  maxGrossWeightKg?: number;
}

export interface CartonOrientation {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PackingGrid {
  x: number;
  y: number;
  z: number;
}

export interface UnusedSpace {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export type LoadLimitingFactor = "SPACE" | "WEIGHT" | "EQUAL";

export type PackingFailureReason =
  | "CARGO_DIMENSIONS_EXCEED_CONTAINER"
  | "CARGO_WEIGHT_EXCEEDS_PAYLOAD";

export interface OrientationCapacity {
  orientation: CartonOrientation;
  grid: PackingGrid;
  spatialCapacity: number;
  weightCapacity: number;
  usableCapacity: number;
  unusedSpace: UnusedSpace;
}

export interface PackingResult {
  containerId: string;
  containerName: string;
  cartonsLoaded: number;
  totalUnits: number;
  totalCargoWeightKg: number;
  cargoVolumeM3: number;
  containerVolumeM3: number;
  volumeUtilizationPercent: number;
  payloadUtilizationPercent: number;
  limitingFactor: LoadLimitingFactor;
  orientation: CartonOrientation;
  grid: PackingGrid;
  unusedSpace: UnusedSpace;
  orientationResults: OrientationCapacity[];
  reason?: PackingFailureReason;
}

export interface CargoPosition {
  id: string;
  x: number;
  y: number;
  z: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  layer: number;
}

export interface CargoLayer {
  layer: number;
  cartonCount: number;
}

export type LoadCalculationErrorCode =
  | "INVALID_DIMENSION"
  | "INVALID_WEIGHT"
  | "INVALID_UNITS_PER_CARTON"
  | "INVALID_CONTAINER";

export class LoadCalculationError extends Error {
  constructor(
    public readonly code: LoadCalculationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LoadCalculationError";
  }
}
