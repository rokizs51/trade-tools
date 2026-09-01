export type CurrencyCode = "IDR" | "USD";

export type QuantityUnit = "KG";

export type CostStage = "EXW" | "FOB" | "CFR" | "CIF";

export type Incoterm = "FOB" | "CFR" | "CIF";

export type DecimalInput = string | number;

export interface ShipmentQuantity {
  value: DecimalInput;
  unit: QuantityUnit;
}

export interface ExchangeRates {
  USD_IDR?: DecimalInput;
}

export interface CostItem {
  id?: string;
  name: string;
  amount: DecimalInput;
  currency: CurrencyCode;
  stage: CostStage;
}

export type PricingInput =
  | {
      type: "MARGIN";
      targetMargin: DecimalInput;
    }
  | {
      type: "MARKUP";
      markup: DecimalInput;
    }
  | {
      type: "BUYER_OFFER";
      offerPricePerKg: DecimalInput;
    };

export interface CostingInput {
  quantity: ShipmentQuantity;
  quotationCurrency: CurrencyCode;
  exchangeRates: ExchangeRates;
  incoterm: Incoterm;
  costs: CostItem[];
  pricing: PricingInput;
}

export interface StageTotals {
  exw: string;
  fob: string;
  cfr: string;
  cif: string;
}

export interface StageUnitCosts {
  exwPerKg: string;
  fobPerKg: string;
  cfrPerKg: string;
  cifPerKg: string;
}

export interface PricingResult {
  breakEvenPricePerKg: string;
  sellingPricePerKg: string;
  revenue: string;
  profit: string;
  margin: string;
  markup: string;
  isBelowBreakEven: boolean;
}

export interface CostingResult {
  currency: CurrencyCode;
  quantity: ShipmentQuantity;
  selectedIncoterm: Incoterm;
  selectedTotalCost: string;
  selectedCostPerKg: string;
  stageTotals: StageTotals;
  stageUnitCosts: StageUnitCosts;
  pricing: PricingResult;
}

export type CalculationErrorCode =
  | "INVALID_QUANTITY"
  | "INVALID_EXCHANGE_RATE"
  | "INVALID_COST"
  | "INVALID_MARGIN"
  | "INVALID_MARKUP"
  | "INVALID_BUYER_OFFER";

export class CalculationError extends Error {
  constructor(
    public readonly code: CalculationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CalculationError";
  }
}
