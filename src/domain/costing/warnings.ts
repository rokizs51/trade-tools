import type { CostItem, Incoterm } from "./types.js";

export type CalculationWarningCode =
  | "BELOW_BREAK_EVEN"
  | "MISSING_FREIGHT"
  | "MISSING_INSURANCE";

export interface CalculationWarning {
  code: CalculationWarningCode;
  message: string;
}

export function getCalculationWarnings(input: {
  incoterm: Incoterm;
  costs: CostItem[];
  isBelowBreakEven: boolean;
}): CalculationWarning[] {
  const warnings: CalculationWarning[] = [];

  if (input.isBelowBreakEven) {
    warnings.push({
      code: "BELOW_BREAK_EVEN",
      message: "Buyer offer is below break-even.",
    });
  }

  if ((input.incoterm === "CFR" || input.incoterm === "CIF") && !hasPositiveNamedCost(input.costs, "freight")) {
    warnings.push({
      code: "MISSING_FREIGHT",
      message: "No freight cost has been entered.",
    });
  }

  if (input.incoterm === "CIF" && !hasPositiveNamedCost(input.costs, "insurance")) {
    warnings.push({
      code: "MISSING_INSURANCE",
      message: "No insurance cost has been entered.",
    });
  }

  return warnings;
}

function hasPositiveNamedCost(costs: CostItem[], expectedName: string): boolean {
  return costs.some((cost) => {
    const amount = Number(cost.amount);
    return cost.name.trim().toLowerCase() === expectedName && Number.isFinite(amount) && amount > 0;
  });
}
