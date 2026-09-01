import { Decimal } from "./decimal.js";
import { CalculationError, type CurrencyCode, type ExchangeRates } from "./types.js";

export function convertCurrency(
  amount: Decimal,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  exchangeRates: ExchangeRates,
): Decimal {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const usdIdr = parseUsdIdrRate(exchangeRates);

  if (fromCurrency === "IDR" && toCurrency === "USD") {
    return amount.divide(usdIdr);
  }

  if (fromCurrency === "USD" && toCurrency === "IDR") {
    return amount.multiply(usdIdr);
  }

  throw new CalculationError(
    "INVALID_EXCHANGE_RATE",
    `Missing conversion path from ${fromCurrency} to ${toCurrency}.`,
  );
}

export function parseUsdIdrRate(exchangeRates: ExchangeRates): Decimal {
  if (exchangeRates.USD_IDR === undefined) {
    throw new CalculationError("INVALID_EXCHANGE_RATE", "USD_IDR exchange rate is required.");
  }

  let rate: Decimal;

  try {
    rate = Decimal.from(exchangeRates.USD_IDR);
  } catch {
    throw new CalculationError("INVALID_EXCHANGE_RATE", "USD_IDR exchange rate must be a valid decimal.");
  }

  if (!rate.isPositive()) {
    throw new CalculationError("INVALID_EXCHANGE_RATE", "USD_IDR exchange rate must be greater than zero.");
  }

  return rate;
}
