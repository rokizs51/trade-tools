import type { ContainerSpecification } from "./types.js";

export const containerSpecifications: readonly ContainerSpecification[] = [
  {
    id: "20ft-gp",
    name: "20FT General Purpose",
    internalLengthMm: 5898,
    internalWidthMm: 2352,
    internalHeightMm: 2393,
    maxPayloadKg: 28230,
    tareWeightKg: 2250,
    maxGrossWeightKg: 30480,
  },
  {
    id: "40ft-gp",
    name: "40FT General Purpose",
    internalLengthMm: 12032,
    internalWidthMm: 2352,
    internalHeightMm: 2393,
    maxPayloadKg: 26740,
    tareWeightKg: 3740,
    maxGrossWeightKg: 30480,
  },
  {
    id: "40ft-hc",
    name: "40FT High Cube",
    internalLengthMm: 12032,
    internalWidthMm: 2352,
    internalHeightMm: 2698,
    maxPayloadKg: 26640,
    tareWeightKg: 3840,
    maxGrossWeightKg: 30480,
  },
] as const;

export function getContainerSpecification(containerId: string): ContainerSpecification | undefined {
  return containerSpecifications.find((container) => container.id === containerId);
}
