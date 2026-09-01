import assert from "node:assert/strict";
import test from "node:test";

import { getCalculationWarnings } from "../dist/domain/costing/index.js";

test("does not warn for FOB when freight and insurance are missing", () => {
  const warnings = getCalculationWarnings({
    incoterm: "FOB",
    costs: [{ name: "Product", amount: "1000", currency: "USD", stage: "EXW" }],
    isBelowBreakEven: false,
  });

  assert.deepEqual(warnings, []);
});

test("warns when CFR is selected and freight is missing", () => {
  const warnings = getCalculationWarnings({
    incoterm: "CFR",
    costs: [{ name: "Product", amount: "1000", currency: "USD", stage: "EXW" }],
    isBelowBreakEven: false,
  });

  assert.deepEqual(warnings.map((warning) => warning.code), ["MISSING_FREIGHT"]);
});

test("warns when CIF is selected and freight or insurance is missing", () => {
  const warnings = getCalculationWarnings({
    incoterm: "CIF",
    costs: [{ name: "Product", amount: "1000", currency: "USD", stage: "EXW" }],
    isBelowBreakEven: false,
  });

  assert.deepEqual(warnings.map((warning) => warning.code), ["MISSING_FREIGHT", "MISSING_INSURANCE"]);
});

test("does not warn for missing freight or insurance when both have positive amounts", () => {
  const warnings = getCalculationWarnings({
    incoterm: "CIF",
    costs: [
      { name: "Freight", amount: "100", currency: "USD", stage: "CFR" },
      { name: "Insurance", amount: "10", currency: "USD", stage: "CIF" },
    ],
    isBelowBreakEven: false,
  });

  assert.deepEqual(warnings, []);
});

test("warns when buyer offer is below break-even", () => {
  const warnings = getCalculationWarnings({
    incoterm: "FOB",
    costs: [{ name: "Product", amount: "1000", currency: "USD", stage: "EXW" }],
    isBelowBreakEven: true,
  });

  assert.deepEqual(warnings.map((warning) => warning.code), ["BELOW_BREAK_EVEN"]);
});
