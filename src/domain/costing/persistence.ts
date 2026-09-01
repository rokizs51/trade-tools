import type { CostingResult, CostItem, CurrencyCode, ExchangeRates, Incoterm, PricingInput, ShipmentQuantity } from "./types.js";

export type CostingStatus = "ACTIVE" | "ARCHIVED";

export interface CostingDraft {
  name: string;
  product: string;
  quantity: ShipmentQuantity;
  incoterm: Incoterm;
  quotationCurrency: CurrencyCode;
  exchangeRates: ExchangeRates;
  costs: CostItem[];
  pricing: PricingInput;
  result: CostingResult;
}

export interface SavedCosting extends CostingDraft {
  id: string;
  status: CostingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "export-cost-calculator.costings.v1";

export function listSavedCostings(storage: StorageLike): SavedCosting[] {
  const value = storage.getItem(STORAGE_KEY);

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return (parsed as SavedCosting[]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export function getSavedCosting(storage: StorageLike, id: string): SavedCosting | undefined {
  return listSavedCostings(storage).find((costing) => costing.id === id);
}

export function archiveCosting(storage: StorageLike, id: string, now: string): SavedCosting | undefined {
  const savedCostings = listSavedCostings(storage);
  const existing = savedCostings.find((costing) => costing.id === id);

  if (!existing) {
    return undefined;
  }

  const archived: SavedCosting = {
    ...existing,
    status: "ARCHIVED",
    updatedAt: now,
  };

  storage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      archived,
      ...savedCostings.filter((costing) => costing.id !== id),
    ]),
  );

  return archived;
}

export function deleteCosting(storage: StorageLike, id: string): boolean {
  const savedCostings = listSavedCostings(storage);
  const nextCostings = savedCostings.filter((costing) => costing.id !== id);

  if (nextCostings.length === savedCostings.length) {
    return false;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(nextCostings));
  return true;
}

export function saveCosting(
  storage: StorageLike,
  draft: CostingDraft,
  options: {
    existingId?: string;
    now: string;
    createId: () => string;
  },
): SavedCosting {
  const savedCostings = listSavedCostings(storage);
  const existing = options.existingId
    ? savedCostings.find((costing) => costing.id === options.existingId)
    : undefined;

  const saved: SavedCosting = {
    ...draft,
    id: existing?.id ?? options.createId(),
    status: existing?.status ?? "ACTIVE",
    createdAt: existing?.createdAt ?? options.now,
    updatedAt: options.now,
  };

  const nextCostings = [
    saved,
    ...savedCostings.filter((costing) => costing.id !== saved.id),
  ];

  storage.setItem(STORAGE_KEY, JSON.stringify(nextCostings));
  return saved;
}

export function createDuplicateDraft(source: SavedCosting): CostingDraft {
  return {
    name: `${source.name} Copy`,
    product: source.product,
    quantity: clone(source.quantity),
    incoterm: source.incoterm,
    quotationCurrency: source.quotationCurrency,
    exchangeRates: clone(source.exchangeRates),
    costs: clone(source.costs),
    pricing: clone(source.pricing),
    result: clone(source.result),
  };
}

export function clearSavedCostings(storage: StorageLike): void {
  storage.setItem(STORAGE_KEY, JSON.stringify([]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
