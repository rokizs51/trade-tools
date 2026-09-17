export class BuyerDiscoveryBudgetExceededError extends Error {
  readonly code = "BUYER_DISCOVERY_BUDGET_EXCEEDED";

  constructor(readonly estimatedCostUsd: number, readonly maximumCostUsd: number) {
    super(
      `Buyer discovery estimated cost $${estimatedCostUsd.toFixed(6)} exceeded the configured maximum of $${maximumCostUsd.toFixed(6)}.`,
    );
    this.name = "BuyerDiscoveryBudgetExceededError";
  }
}

export class BuyerDiscoveryTimeoutError extends Error {
  readonly code = "BUYER_DISCOVERY_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super(`Buyer discovery exceeded its ${timeoutMs} ms time limit.`);
    this.name = "BuyerDiscoveryTimeoutError";
  }
}

export function isRetryableBuyerDiscoveryError(error: unknown): boolean {
  for (const candidate of errorChain(error)) {
    if (candidate.name === "OpenRouterModelCapabilityError" || candidate.name === "ZodError") {
      return false;
    }

    const statusCode = readStatusCode(candidate);

    if (statusCode === 408 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
      return true;
    }

    if (
      candidate.name === "RequestTimeoutError" ||
      candidate.name === "ConnectionError" ||
      candidate.name === "TimeoutError"
    ) {
      return true;
    }
  }

  return false;
}

function* errorChain(error: unknown): Generator<Record<string, unknown>> {
  let current = error;
  let depth = 0;

  while (current && typeof current === "object" && depth < 6) {
    const candidate = current as Record<string, unknown>;
    yield candidate;
    current = candidate.cause;
    depth += 1;
  }
}

function readStatusCode(error: Record<string, unknown>): number | undefined {
  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }

  const nested = error.error;
  if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).code === "number") {
    return (nested as Record<string, unknown>).code as number;
  }

  return undefined;
}
