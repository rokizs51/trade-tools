import type { PackingResult } from "./types.js";

export interface LoadCostingSeed {
  costingName: string;
  product: string;
  quantityKg: string;
  note: string;
}

export function createLoadCostingSeed(result: PackingResult, productName: string): LoadCostingSeed {
  const product = productName.trim();
  const displayProduct = product || "Untitled product";

  return {
    costingName: `${displayProduct} ${result.containerName}`,
    product,
    quantityKg: String(result.totalCargoWeightKg),
    note: `${result.containerName}: ${result.cartonsLoaded} cartons / ${result.totalUnits} units.`,
  };
}
