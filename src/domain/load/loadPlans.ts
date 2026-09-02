import type { CargoInput, PackingResult } from "./types.js";

export type LoadPlanMode = "FLOOR_LOADED";
export type LoadPlanStatus = "ACTIVE" | "ARCHIVED";

export interface LoadPlanDraft {
  name: string;
  cargoInput: CargoInput;
  containerId: string;
  loadingMode: LoadPlanMode;
  result: PackingResult;
  comparisons: PackingResult[];
}

export interface SavedLoadPlan extends LoadPlanDraft {
  id: string;
  status: LoadPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export function createDuplicateLoadPlanDraft(source: SavedLoadPlan): LoadPlanDraft {
  return {
    name: `${source.name} Copy`,
    cargoInput: clone(source.cargoInput),
    containerId: source.containerId,
    loadingMode: source.loadingMode,
    result: clone(source.result),
    comparisons: clone(source.comparisons),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
