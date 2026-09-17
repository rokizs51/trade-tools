import { isRetryableBuyerDiscoveryError } from "./errors.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  signal: AbortSignal;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  onRetry?: (error: unknown, retryNumber: number, delayMs: number) => void;
}

export async function withBuyerDiscoveryRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let attempt = 0;

  while (true) {
    throwIfAborted(options.signal);

    try {
      return await operation(attempt);
    } catch (error) {
      if (
        options.signal.aborted ||
        attempt >= options.maxRetries ||
        !isRetryableBuyerDiscoveryError(error)
      ) {
        throw error;
      }

      attempt += 1;
      const delayMs = calculateBackoff(
        options.baseDelayMs,
        attempt,
        options.random?.() ?? Math.random(),
      );
      options.onRetry?.(error, attempt, delayMs);
      await (options.sleep ?? abortableSleep)(delayMs, options.signal);
    }
  }
}

function calculateBackoff(baseDelayMs: number, retryNumber: number, randomValue: number): number {
  const exponentialDelay = baseDelayMs * (2 ** (retryNumber - 1));
  const jitter = exponentialDelay * 0.25 * Math.max(0, Math.min(1, randomValue));
  return Math.round(exponentialDelay + jitter);
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    function onAbort() {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("Buyer discovery was aborted."));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Buyer discovery was aborted.");
  }
}
