/**
 * Money in integer minor units (cents). Never use floats for amounts (BR-10, ADR-0009).
 * Percentages are expressed in basis points (1 bp = 0.01 %) so every computation stays integral.
 */

export const CURRENCIES = ["EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Money = Readonly<{ amountCents: number; currency: Currency }>;

/** Rounding is always an explicit choice of the caller: no business rule is implied here. */
export type RoundingMode = "floor" | "ceil" | "halfUp" | "halfEven";

export type MoneyErrorCode = "NOT_AN_INTEGER" | "CURRENCY_MISMATCH" | "UNSAFE_AMOUNT";

export class MoneyError extends Error {
  constructor(
    readonly code: MoneyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new MoneyError("NOT_AN_INTEGER", `${label} must be an integer, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError("UNSAFE_AMOUNT", `${label} exceeds the safe integer range`);
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError("CURRENCY_MISMATCH", `Cannot combine ${a.currency} with ${b.currency}`);
  }
}

/** Negative amounts are allowed (discount and refund lines); callers enforce sign rules. */
export function money(amountCents: number, currency: Currency = "EUR"): Money {
  assertSafeInteger(amountCents, "amountCents");
  return Object.freeze({ amountCents, currency });
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountCents + b.amountCents, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountCents - b.amountCents, a.currency);
}

export function multiply(m: Money, quantity: number): Money {
  assertSafeInteger(quantity, "quantity");
  return money(m.amountCents * quantity, m.currency);
}

export function sum(items: readonly Money[], currency: Currency = "EUR"): Money {
  return items.reduce((total, item) => add(total, item), money(0, currency));
}

/** Integer division of numerator by a positive denominator with the given rounding. */
export function divideRounded(numerator: number, denominator: number, mode: RoundingMode): number {
  assertSafeInteger(numerator, "numerator");
  assertSafeInteger(denominator, "denominator");
  if (denominator <= 0) {
    throw new RangeError("denominator must be positive");
  }
  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  if (remainder === 0) return quotient;

  const sign = numerator < 0 ? -1 : 1;
  const twiceRemainder = Math.abs(remainder) * 2;
  switch (mode) {
    case "floor":
      return sign < 0 ? quotient - 1 : quotient;
    case "ceil":
      return sign > 0 ? quotient + 1 : quotient;
    case "halfUp":
      return twiceRemainder >= denominator ? quotient + sign : quotient;
    case "halfEven":
      if (twiceRemainder > denominator) return quotient + sign;
      if (twiceRemainder < denominator) return quotient;
      return quotient % 2 === 0 ? quotient : quotient + sign;
  }
}

const BASIS_POINTS_PER_UNIT = 10_000;

/** Returns `basisPoints` of `m` (e.g. 1_000 bp = 10 %, 550 bp = 5.5 %). */
export function percentage(m: Money, basisPoints: number, mode: RoundingMode): Money {
  assertSafeInteger(basisPoints, "basisPoints");
  const product = m.amountCents * basisPoints;
  assertSafeInteger(product, "amountCents × basisPoints");
  return money(divideRounded(product, BASIS_POINTS_PER_UNIT, mode), m.currency);
}

export type DisplayLocale = "fr" | "en";

const INTL_LOCALES: Record<DisplayLocale, string> = { fr: "fr-FR", en: "en-GB" };

/** Display only: converting to a decimal number is safe here because nothing is computed from it. */
export function formatMoney(m: Money, locale: DisplayLocale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: "currency",
    currency: m.currency,
  }).format(m.amountCents / 100);
}
