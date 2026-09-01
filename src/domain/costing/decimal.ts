const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

export class Decimal {
  private constructor(private readonly raw: bigint) {}

  static zero(): Decimal {
    return new Decimal(0n);
  }

  static one(): Decimal {
    return new Decimal(SCALE);
  }

  static from(value: string | number): Decimal {
    const normalized = String(value).trim();
    const match = normalized.match(/^([+-])?(\d+)(?:\.(\d+))?$/);

    if (!match) {
      throw new Error(`Invalid decimal: ${value}`);
    }

    const sign = match[1] === "-" ? -1n : 1n;
    const whole = BigInt(match[2] ?? "0") * SCALE;
    const fractionText = (match[3] ?? "").padEnd(SCALE_DIGITS, "0").slice(0, SCALE_DIGITS);
    const fraction = BigInt(fractionText || "0");

    return new Decimal(sign * (whole + fraction));
  }

  add(other: Decimal): Decimal {
    return new Decimal(this.raw + other.raw);
  }

  subtract(other: Decimal): Decimal {
    return new Decimal(this.raw - other.raw);
  }

  multiply(other: Decimal): Decimal {
    return new Decimal(roundDiv(this.raw * other.raw, SCALE));
  }

  divide(other: Decimal): Decimal {
    if (other.raw === 0n) {
      throw new Error("Cannot divide by zero");
    }

    return new Decimal(roundDiv(this.raw * SCALE, other.raw));
  }

  isZero(): boolean {
    return this.raw === 0n;
  }

  isPositive(): boolean {
    return this.raw > 0n;
  }

  isNegative(): boolean {
    return this.raw < 0n;
  }

  isGreaterThanOrEqual(other: Decimal): boolean {
    return this.raw >= other.raw;
  }

  isLessThan(other: Decimal): boolean {
    return this.raw < other.raw;
  }

  toString(): string {
    if (this.raw === 0n) {
      return "0";
    }

    const sign = this.raw < 0n ? "-" : "";
    const absolute = this.raw < 0n ? -this.raw : this.raw;
    const whole = absolute / SCALE;
    const fraction = absolute % SCALE;

    if (fraction === 0n) {
      return `${sign}${whole}`;
    }

    const fractionText = fraction.toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
    return `${sign}${whole}.${fractionText}`;
  }
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n) {
    return quotient;
  }

  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const shouldRoundAwayFromZero = absoluteRemainder * 2n >= absoluteDenominator;

  if (!shouldRoundAwayFromZero) {
    return quotient;
  }

  return (numerator > 0n) === (denominator > 0n) ? quotient + 1n : quotient - 1n;
}
