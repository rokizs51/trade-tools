import type { CargoLayer, CargoPosition, PackingResult } from "./types.js";

export function generateCargoPositions(result: PackingResult): CargoPosition[] {
  if (result.cartonsLoaded === 0) {
    return [];
  }

  const positions: CargoPosition[] = [];
  const { orientation, grid } = result;

  for (let zIndex = 0; zIndex < grid.z; zIndex += 1) {
    for (let yIndex = 0; yIndex < grid.y; yIndex += 1) {
      for (let xIndex = 0; xIndex < grid.x; xIndex += 1) {
        if (positions.length >= result.cartonsLoaded) {
          return positions;
        }

        positions.push({
          id: `carton-${positions.length + 1}`,
          x: xIndex * orientation.lengthMm,
          y: yIndex * orientation.widthMm,
          z: zIndex * orientation.heightMm,
          lengthMm: orientation.lengthMm,
          widthMm: orientation.widthMm,
          heightMm: orientation.heightMm,
          rotationX: 0,
          rotationY: 0,
          rotationZ: 0,
          layer: zIndex + 1,
        });
      }
    }
  }

  return positions;
}

export function getCargoLayers(positions: readonly CargoPosition[]): CargoLayer[] {
  const layerCounts = new Map<number, number>();

  for (const position of positions) {
    layerCounts.set(position.layer, (layerCounts.get(position.layer) ?? 0) + 1);
  }

  return Array.from(layerCounts.entries())
    .sort(([leftLayer], [rightLayer]) => leftLayer - rightLayer)
    .map(([layer, cartonCount]) => ({ layer, cartonCount }));
}

export function getPackingLayers(result: PackingResult): CargoLayer[] {
  if (result.cartonsLoaded === 0) {
    return [];
  }

  const layerCapacity = result.grid.x * result.grid.y;

  if (layerCapacity <= 0) {
    return [];
  }

  const layerCount = Math.min(result.grid.z, Math.ceil(result.cartonsLoaded / layerCapacity));

  return Array.from({ length: layerCount }, (_, index) => {
    const layer = index + 1;
    const cartonsBeforeLayer = index * layerCapacity;
    const remainingCartons = result.cartonsLoaded - cartonsBeforeLayer;

    return {
      layer,
      cartonCount: Math.min(layerCapacity, remainingCartons),
    };
  });
}

export function filterCargoPositionsByLayer(
  positions: readonly CargoPosition[],
  layer: number | "ALL",
): CargoPosition[] {
  if (layer === "ALL") {
    return [...positions];
  }

  return positions.filter((position) => position.layer === layer);
}
