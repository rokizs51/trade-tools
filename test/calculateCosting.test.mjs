import assert from "node:assert/strict";
import test from "node:test";

import { CalculationError, calculateCosting } from "../dist/domain/costing/index.js";

function assertClose(actual, expected, decimals = 6) {
  assert.equal(Number(actual).toFixed(decimals), Number(expected).toFixed(decimals));
}

const baseCosts = [
  { name: "Product", amount: "162500000", currency: "IDR", stage: "EXW" },
  { name: "Packaging", amount: "10000000", currency: "IDR", stage: "EXW" },
  { name: "Trucking", amount: "5000000", currency: "IDR", stage: "FOB" },
  { name: "Documentation", amount: "2500000", currency: "IDR", stage: "FOB" },
  { name: "Port Charges", amount: "6000000", currency: "IDR", stage: "FOB" },
  { name: "Freight", amount: "1450", currency: "USD", stage: "CFR" },
  { name: "Insurance", amount: "80", currency: "USD", stage: "CIF" },
];

function makeInput(overrides = {}) {
  return {
    quantity: { value: "25000", unit: "KG" },
    quotationCurrency: "USD",
    exchangeRates: { USD_IDR: "16500" },
    incoterm: "CIF",
    costs: baseCosts,
    pricing: { type: "MARGIN", targetMargin: "0.20" },
    ...overrides,
  };
}

const ruleCosts = [
  { name: "Product", amount: "100", currency: "USD", stage: "EXW" },
  { name: "Packaging", amount: "20", currency: "USD", stage: "EXW" },
  { name: "Processing", amount: "5", currency: "USD", stage: "EXW" },
  { name: "Trucking", amount: "10", currency: "USD", stage: "FOB" },
  { name: "Documentation", amount: "4", currency: "USD", stage: "FOB" },
  { name: "Port Charges", amount: "6", currency: "USD", stage: "FOB" },
  { name: "Custom FOB Cost", amount: "5", currency: "USD", stage: "FOB" },
  { name: "Freight", amount: "50", currency: "USD", stage: "CFR" },
  { name: "Custom CFR Cost", amount: "25", currency: "USD", stage: "CFR" },
  { name: "Insurance", amount: "15", currency: "USD", stage: "CIF" },
  { name: "Custom CIF Cost", amount: "10", currency: "USD", stage: "CIF" },
];

function makeRuleInput(overrides = {}) {
  return makeInput({
    quantity: { value: "1000", unit: "KG" },
    quotationCurrency: "USD",
    exchangeRates: { USD_IDR: "16000" },
    incoterm: "CIF",
    costs: ruleCosts,
    pricing: { type: "MARGIN", targetMargin: "0.20" },
    ...overrides,
  });
}

test("calculates EXW, FOB, CFR, CIF and margin pricing for the PRD example", () => {
  const result = calculateCosting(makeInput());

  assertClose(result.stageTotals.exw, "10454.545454545455");
  assertClose(result.stageTotals.fob, "11272.727272727273");
  assertClose(result.stageTotals.cfr, "12722.727272727273");
  assertClose(result.stageTotals.cif, "12802.727272727273");
  assertClose(result.stageUnitCosts.fobPerKg, "0.450909090909");
  assertClose(result.stageUnitCosts.cfrPerKg, "0.508909090909");
  assertClose(result.stageUnitCosts.cifPerKg, "0.512109090909");
  assertClose(result.selectedCostPerKg, "0.512109090909");
  assertClose(result.pricing.breakEvenPricePerKg, "0.512109090909");
  assertClose(result.pricing.sellingPricePerKg, "0.640136363636");
  assertClose(result.pricing.revenue, "16003.4090909");
  assertClose(result.pricing.profit, "3200.681818172727");
  assert.equal(result.pricing.margin, "0.2");
  assert.equal(result.pricing.isBelowBreakEven, false);
});

test("calculates EXW as Product plus Packaging plus Processing", () => {
  const result = calculateCosting(makeRuleInput());

  assert.equal(result.stageTotals.exw, "125");
  assert.equal(result.stageUnitCosts.exwPerKg, "0.125");
});

test("calculates FOB as EXW plus trucking, documentation, port charges, and custom FOB costs", () => {
  const result = calculateCosting(makeRuleInput({ incoterm: "FOB" }));

  assert.equal(result.stageTotals.fob, "150");
  assert.equal(result.stageUnitCosts.fobPerKg, "0.15");
  assert.equal(result.selectedTotalCost, "150");
  assert.equal(result.selectedCostPerKg, "0.15");
});

test("calculates CFR as FOB plus freight and custom CFR costs", () => {
  const result = calculateCosting(makeRuleInput({ incoterm: "CFR" }));

  assert.equal(result.stageTotals.cfr, "225");
  assert.equal(result.stageUnitCosts.cfrPerKg, "0.225");
  assert.equal(result.selectedTotalCost, "225");
  assert.equal(result.selectedCostPerKg, "0.225");
});

test("calculates CIF as CFR plus insurance and custom CIF costs", () => {
  const result = calculateCosting(makeRuleInput({ incoterm: "CIF" }));

  assert.equal(result.stageTotals.cif, "250");
  assert.equal(result.stageUnitCosts.cifPerKg, "0.25");
  assert.equal(result.selectedTotalCost, "250");
  assert.equal(result.selectedCostPerKg, "0.25");
});

test("calculates cost per kg from each cumulative stage total", () => {
  const result = calculateCosting(makeRuleInput({ quantity: { value: "500", unit: "KG" } }));

  assert.equal(result.stageUnitCosts.exwPerKg, "0.25");
  assert.equal(result.stageUnitCosts.fobPerKg, "0.3");
  assert.equal(result.stageUnitCosts.cfrPerKg, "0.45");
  assert.equal(result.stageUnitCosts.cifPerKg, "0.5");
});

test("converts USD costs into IDR when IDR is the quotation currency", () => {
  const result = calculateCosting(
    makeInput({
      quotationCurrency: "IDR",
      incoterm: "CFR",
      costs: [
        { name: "Product", amount: "1000000", currency: "IDR", stage: "EXW" },
        { name: "Freight", amount: "100", currency: "USD", stage: "CFR" },
      ],
      pricing: { type: "MARKUP", markup: "0.10" },
    }),
  );

  assert.equal(result.stageTotals.exw, "1000000");
  assert.equal(result.stageTotals.cfr, "2650000");
  assert.equal(result.selectedCostPerKg, "106");
  assert.equal(result.pricing.sellingPricePerKg, "116.6");
});

test("converts IDR costs into USD when USD is the quotation currency", () => {
  const result = calculateCosting(
    makeInput({
      quantity: { value: "100", unit: "KG" },
      quotationCurrency: "USD",
      exchangeRates: { USD_IDR: "16000" },
      incoterm: "FOB",
      costs: [
        { name: "Product", amount: "1600000", currency: "IDR", stage: "EXW" },
        { name: "Trucking", amount: "320000", currency: "IDR", stage: "FOB" },
      ],
      pricing: { type: "MARKUP", markup: "0" },
    }),
  );

  assert.equal(result.stageTotals.exw, "100");
  assert.equal(result.stageTotals.fob, "120");
  assert.equal(result.selectedCostPerKg, "1.2");
});

test("leaves costs in quotation currency unchanged while converting mixed-currency rows", () => {
  const result = calculateCosting(
    makeInput({
      quantity: { value: "10", unit: "KG" },
      quotationCurrency: "USD",
      exchangeRates: { USD_IDR: "16000" },
      incoterm: "CFR",
      costs: [
        { name: "Product", amount: "100", currency: "USD", stage: "EXW" },
        { name: "Trucking", amount: "160000", currency: "IDR", stage: "FOB" },
        { name: "Freight", amount: "40", currency: "USD", stage: "CFR" },
      ],
      pricing: { type: "MARKUP", markup: "0" },
    }),
  );

  assert.equal(result.stageTotals.exw, "100");
  assert.equal(result.stageTotals.fob, "110");
  assert.equal(result.stageTotals.cfr, "150");
  assert.equal(result.selectedCostPerKg, "15");
});

test("calculates target margin price as cost divided by one minus target margin", () => {
  const result = calculateCosting(
    makeRuleInput({
      incoterm: "CIF",
      pricing: { type: "MARGIN", targetMargin: "0.20" },
    }),
  );

  assert.equal(result.pricing.breakEvenPricePerKg, "0.25");
  assert.equal(result.pricing.sellingPricePerKg, "0.3125");
  assert.equal(result.pricing.revenue, "312.5");
  assert.equal(result.pricing.profit, "62.5");
  assert.equal(result.pricing.margin, "0.2");
  assert.equal(result.pricing.markup, "0.25");
});

test("calculates target markup selling price", () => {
  const result = calculateCosting(
    makeInput({
      costs: [{ name: "Product", amount: "1000", currency: "USD", stage: "EXW" }],
      incoterm: "FOB",
      pricing: { type: "MARKUP", markup: "0.25" },
    }),
  );

  assert.equal(result.selectedCostPerKg, "0.04");
  assert.equal(result.pricing.sellingPricePerKg, "0.05");
  assert.equal(result.pricing.revenue, "1250");
  assert.equal(result.pricing.profit, "250");
  assert.equal(result.pricing.margin, "0.2");
  assert.equal(result.pricing.markup, "0.25");
});

test("calculates target markup price as cost multiplied by one plus markup", () => {
  const result = calculateCosting(
    makeRuleInput({
      incoterm: "CIF",
      pricing: { type: "MARKUP", markup: "0.20" },
    }),
  );

  assert.equal(result.pricing.breakEvenPricePerKg, "0.25");
  assert.equal(result.pricing.sellingPricePerKg, "0.3");
  assert.equal(result.pricing.revenue, "300");
  assert.equal(result.pricing.profit, "50");
  assert.equal(result.pricing.margin, "0.166666666667");
  assert.equal(result.pricing.markup, "0.2");
});

test("calculates buyer offer profitability and loss status", () => {
  const result = calculateCosting(
    makeInput({
      costs: [{ name: "Product", amount: "1000", currency: "USD", stage: "EXW" }],
      incoterm: "FOB",
      pricing: { type: "BUYER_OFFER", offerPricePerKg: "0.03" },
    }),
  );

  assert.equal(result.pricing.revenue, "750");
  assert.equal(result.pricing.profit, "-250");
  assert.equal(result.pricing.margin, "-0.333333333333");
  assert.equal(result.pricing.markup, "-0.25");
  assert.equal(result.pricing.isBelowBreakEven, true);
});

test("calculates buyer offer revenue, profit, margin, and markup above break-even", () => {
  const result = calculateCosting(
    makeRuleInput({
      incoterm: "CIF",
      pricing: { type: "BUYER_OFFER", offerPricePerKg: "0.40" },
    }),
  );

  assert.equal(result.pricing.sellingPricePerKg, "0.4");
  assert.equal(result.pricing.revenue, "400");
  assert.equal(result.pricing.profit, "150");
  assert.equal(result.pricing.margin, "0.375");
  assert.equal(result.pricing.markup, "0.6");
  assert.equal(result.pricing.isBelowBreakEven, false);
});

test("marks buyer offer below break-even when offer is less than selected cost per kg", () => {
  const result = calculateCosting(
    makeRuleInput({
      incoterm: "CIF",
      pricing: { type: "BUYER_OFFER", offerPricePerKg: "0.24" },
    }),
  );

  assert.equal(result.pricing.breakEvenPricePerKg, "0.25");
  assert.equal(result.pricing.profit, "-10");
  assert.equal(result.pricing.margin, "-0.041666666667");
  assert.equal(result.pricing.isBelowBreakEven, true);
});

test("rejects quantity less than or equal to zero", () => {
  assert.throws(
    () => calculateCosting(makeInput({ quantity: { value: "0", unit: "KG" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_QUANTITY",
  );

  assert.throws(
    () => calculateCosting(makeInput({ quantity: { value: "-1", unit: "KG" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_QUANTITY",
  );
});

test("rejects invalid exchange rates needed for conversion", () => {
  assert.throws(
    () => calculateCosting(makeInput({ exchangeRates: { USD_IDR: "0" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_EXCHANGE_RATE",
  );

  assert.throws(
    () => calculateCosting(makeInput({ exchangeRates: {} })),
    (error) => error instanceof CalculationError && error.code === "INVALID_EXCHANGE_RATE",
  );

  assert.throws(
    () => calculateCosting(makeInput({ exchangeRates: { USD_IDR: "not-a-rate" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_EXCHANGE_RATE",
  );
});

test("rejects negative costs, invalid margin, invalid markup, and invalid buyer offer", () => {
  assert.throws(
    () =>
      calculateCosting(
        makeInput({ costs: [{ name: "Product", amount: "-1", currency: "USD", stage: "EXW" }] }),
      ),
    (error) => error instanceof CalculationError && error.code === "INVALID_COST",
  );

  assert.throws(
    () => calculateCosting(makeInput({ pricing: { type: "MARGIN", targetMargin: "1" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_MARGIN",
  );

  assert.throws(
    () => calculateCosting(makeInput({ pricing: { type: "MARKUP", markup: "-0.01" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_MARKUP",
  );

  assert.throws(
    () => calculateCosting(makeInput({ pricing: { type: "BUYER_OFFER", offerPricePerKg: "-0.01" } })),
    (error) => error instanceof CalculationError && error.code === "INVALID_BUYER_OFFER",
  );
});
