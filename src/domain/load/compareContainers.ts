import type { CargoInput, ContainerSpecification, PackingResult } from "./types.js";
import { calculatePacking } from "./calculatePacking.js";

export function comparePackingAcrossContainers(
  cargoInput: CargoInput,
  containers: readonly ContainerSpecification[],
): PackingResult[] {
  return containers.map((container) => calculatePacking(cargoInput, container));
}
