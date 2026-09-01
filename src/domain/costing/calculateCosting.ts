import { convertCurrency, parseUsdIdrRate } from "./currency.js";
import { Decimal } from "./decimal.js";
import {
  CalculationError,
  type CostingInput,
  type CostingResult,
  type CostStage,
  type PricingInput,
} from "./types.js";

type InternalStageTotals = Record<CostStage, Decimal>;

export function calculateCosting(input: CostingInput): CostingResult {
  const quantity = Decimal.from(input.quantity.value);

  if (!quantity.isPositive()) {
    throw new CalculationError("INVALID_QUANTITY", "Shipment quantity must be greater than zero.");
  }

  parseUsdIdrRate(input.exchangeRates);

  const stageCosts = calculateDirectStageCosts(input);
  const stageTotals = calculateCumulativeStageTotals(stageCosts);
  const selectedTotalCost = stageTotals[input.incoterm];
  const selectedCostPerKg = selectedTotalCost.divide(quantity);
  const pricing = calculatePricing(input.pricing, selectedCostPerKg, quantity, selectedTotalCost);

  return {
    currency: input.quotationCurrency,
    quantity: input.quantity,
    selectedIncoterm: input.incoterm,
    selectedTotalCost: selectedTotalCost.toString(),
    selectedCostPerKg: selectedCostPerKg.toString(),
    stageTotals: {
      exw: stageTotals.EXW.toString(),
      fob: stageTotals.FOB.toString(),
      cfr: stageTotals.CFR.toString(),
      cif: stageTotals.CIF.toString(),
    },
    stageUnitCosts: {
      exwPerKg: stageTotals.EXW.divide(quantity).toString(),
      fobPerKg: stageTotals.FOB.divide(quantity).toString(),
      cfrPerKg: stageTotals.CFR.divide(quantity).toString(),
      cifPerKg: stageTotals.CIF.divide(quantity).toString(),
    },
    pricing,
  };
}

function calculateDirectStageCosts(input: CostingInput): InternalStageTotals {
  const totals = emptyStageTotals();

  for (const cost of input.costs) {
    const amount = Decimal.from(cost.amount);

    if (amount.isNegative()) {
      throw new CalculationError("INVALID_COST", `Cost "${cost.name}" must be zero or greater.`);
    }

    const convertedAmount = convertCurrency(
      amount,
      cost.currency,
      input.quotationCurrency,
      input.exchangeRates,
    );

    totals[cost.stage] = totals[cost.stage].add(convertedAmount);
  }

  return totals;
}

function calculateCumulativeStageTotals(stageCosts: InternalStageTotals): InternalStageTotals {
  const exw = stageCosts.EXW;
  const fob = exw.add(stageCosts.FOB);
  const cfr = fob.add(stageCosts.CFR);
  const cif = cfr.add(stageCosts.CIF);

  return {
    EXW: exw,
    FOB: fob,
    CFR: cfr,
    CIF: cif,
  };
}

function calculatePricing(
  pricing: PricingInput,
  breakEvenPricePerKg: Decimal,
  quantity: Decimal,
  selectedTotalCost: Decimal,
): CostingResult["pricing"] {
  if (pricing.type === "MARGIN") {
    const targetMargin = Decimal.from(pricing.targetMargin);

    if (targetMargin.isNegative() || targetMargin.isGreaterThanOrEqual(Decimal.one())) {
      throw new CalculationError("INVALID_MARGIN", "Target margin must be at least zero and less than one.");
    }

    return buildPricingResult(breakEvenPricePerKg.divide(Decimal.one().subtract(targetMargin)), quantity, selectedTotalCost);
  }

  if (pricing.type === "MARKUP") {
    const markup = Decimal.from(pricing.markup);

    if (markup.isNegative()) {
      throw new CalculationError("INVALID_MARKUP", "Markup must be zero or greater.");
    }

    return buildPricingResult(breakEvenPricePerKg.multiply(Decimal.one().add(markup)), quantity, selectedTotalCost);
  }

  const offerPricePerKg = Decimal.from(pricing.offerPricePerKg);

  if (offerPricePerKg.isNegative()) {
    throw new CalculationError("INVALID_BUYER_OFFER", "Buyer offer must be zero or greater.");
  }

  return buildPricingResult(offerPricePerKg, quantity, selectedTotalCost);
}

function buildPricingResult(
  sellingPricePerKg: Decimal,
  quantity: Decimal,
  selectedTotalCost: Decimal,
): CostingResult["pricing"] {
  const revenue = sellingPricePerKg.multiply(quantity);
  const profit = revenue.subtract(selectedTotalCost);
  const margin = revenue.isZero() ? Decimal.zero() : profit.divide(revenue);
  const markup = selectedTotalCost.isZero() ? Decimal.zero() : profit.divide(selectedTotalCost);
  const breakEvenPricePerKg = selectedTotalCost.divide(quantity);

  return {
    breakEvenPricePerKg: breakEvenPricePerKg.toString(),
    sellingPricePerKg: sellingPricePerKg.toString(),
    revenue: revenue.toString(),
    profit: profit.toString(),
    margin: margin.toString(),
    markup: markup.toString(),
    isBelowBreakEven: sellingPricePerKg.isLessThan(breakEvenPricePerKg),
  };
}

function emptyStageTotals(): InternalStageTotals {
  return {
    EXW: Decimal.zero(),
    FOB: Decimal.zero(),
    CFR: Decimal.zero(),
    CIF: Decimal.zero(),
  };
}
