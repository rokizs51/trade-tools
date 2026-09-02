import type {
  CargoInput,
  CartonOrientation,
  ContainerSpecification,
  LoadLimitingFactor,
  NormalizedCargo,
  OrientationCapacity,
  PackingFailureReason,
  PackingGrid,
  PackingResult,
  UnusedSpace,
} from "./types.js";
import { generateCartonOrientations } from "./orientation.js";
import { normalizeCargo, validateContainerSpecification } from "./units.js";

export function calculatePacking(cargoInput: CargoInput, containerInput: ContainerSpecification | undefined): PackingResult {
  const cargo = normalizeCargo(cargoInput);
  const container = validateContainerSpecification(containerInput);
  const weightCapacity = calculateWeightCapacity(cargo, container);
  const orientationResults = generateCartonOrientations(cargo.dimensions)
    .map((orientation) => calculateOrientationCapacity(cargo, container, orientation, weightCapacity));
  const bestResult = selectBestOrientation(orientationResults);
  const cartonsLoaded = bestResult.usableCapacity;
  const totalCargoWeightKg = roundLoadNumber(cartonsLoaded * cargo.grossWeightKg);
  const cargoVolumeM3 = roundLoadNumber(calculateCartonVolumeM3(bestResult.orientation) * cartonsLoaded);
  const containerVolumeM3 = roundLoadNumber(calculateContainerVolumeM3(container));
  const volumeUtilizationPercent = containerVolumeM3 === 0
    ? 0
    : roundLoadNumber((cargoVolumeM3 / containerVolumeM3) * 100);
  const payloadUtilizationPercent = roundLoadNumber((totalCargoWeightKg / container.maxPayloadKg) * 100);
  const reason = getFailureReason(bestResult.spatialCapacity, weightCapacity);

  return {
    containerId: container.id,
    containerName: container.name,
    cartonsLoaded,
    totalUnits: cartonsLoaded * cargo.unitsPerCarton,
    totalCargoWeightKg,
    cargoVolumeM3,
    containerVolumeM3,
    volumeUtilizationPercent,
    payloadUtilizationPercent,
    limitingFactor: getLimitingFactor(bestResult.spatialCapacity, weightCapacity),
    orientation: bestResult.orientation,
    grid: bestResult.grid,
    unusedSpace: bestResult.unusedSpace,
    orientationResults,
    ...(reason ? { reason } : {}),
  };
}

export function calculateOrientationCapacity(
  cargo: NormalizedCargo,
  container: ContainerSpecification,
  orientation: CartonOrientation,
  weightCapacity = calculateWeightCapacity(cargo, container),
): OrientationCapacity {
  const grid = calculateSpatialGrid(container, orientation);
  const spatialCapacity = grid.x * grid.y * grid.z;
  const usableCapacity = Math.min(spatialCapacity, weightCapacity);

  return {
    orientation,
    grid,
    spatialCapacity,
    weightCapacity,
    usableCapacity,
    unusedSpace: calculateUnusedSpace(container, orientation, grid),
  };
}

export function calculateSpatialGrid(
  container: ContainerSpecification,
  orientation: CartonOrientation,
): PackingGrid {
  return {
    x: Math.floor(container.internalLengthMm / orientation.lengthMm),
    y: Math.floor(container.internalWidthMm / orientation.widthMm),
    z: Math.floor(container.internalHeightMm / orientation.heightMm),
  };
}

export function calculateWeightCapacity(cargo: NormalizedCargo, container: ContainerSpecification): number {
  return Math.floor(container.maxPayloadKg / cargo.grossWeightKg);
}

function selectBestOrientation(results: OrientationCapacity[]): OrientationCapacity {
  return results.reduce((best, candidate) => {
    if (candidate.usableCapacity > best.usableCapacity) {
      return candidate;
    }

    if (
      candidate.usableCapacity === best.usableCapacity
      && candidate.spatialCapacity > best.spatialCapacity
    ) {
      return candidate;
    }

    return best;
  });
}

function getLimitingFactor(spatialCapacity: number, weightCapacity: number): LoadLimitingFactor {
  if (spatialCapacity < weightCapacity) {
    return "SPACE";
  }

  if (weightCapacity < spatialCapacity) {
    return "WEIGHT";
  }

  return "EQUAL";
}

function getFailureReason(spatialCapacity: number, weightCapacity: number): PackingFailureReason | undefined {
  if (spatialCapacity === 0) {
    return "CARGO_DIMENSIONS_EXCEED_CONTAINER";
  }

  if (weightCapacity === 0) {
    return "CARGO_WEIGHT_EXCEEDS_PAYLOAD";
  }

  return undefined;
}

function calculateUnusedSpace(
  container: ContainerSpecification,
  orientation: CartonOrientation,
  grid: PackingGrid,
): UnusedSpace {
  return {
    lengthMm: roundLoadNumber(container.internalLengthMm - (grid.x * orientation.lengthMm)),
    widthMm: roundLoadNumber(container.internalWidthMm - (grid.y * orientation.widthMm)),
    heightMm: roundLoadNumber(container.internalHeightMm - (grid.z * orientation.heightMm)),
  };
}

function calculateCartonVolumeM3(orientation: CartonOrientation): number {
  return (orientation.lengthMm / 1000) * (orientation.widthMm / 1000) * (orientation.heightMm / 1000);
}

function calculateContainerVolumeM3(container: ContainerSpecification): number {
  return (
    (container.internalLengthMm / 1000)
    * (container.internalWidthMm / 1000)
    * (container.internalHeightMm / 1000)
  );
}

function roundLoadNumber(value: number): number {
  return Number(value.toFixed(6));
}
