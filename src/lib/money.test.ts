import { describe, expect, it } from "vitest";

import {
  add,
  divideRounded,
  formatMoney,
  money,
  MoneyError,
  multiply,
  percentage,
  subtract,
  sum,
  type RoundingMode,
} from "./money";

describe("money", () => {
  it("creates frozen integer amounts in EUR by default", () => {
    const m = money(3_500);
    expect(m).toEqual({ amountCents: 3_500, currency: "EUR" });
    expect(Object.isFrozen(m)).toBe(true);
  });

  it.each([12.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY])("rejects non-integer %s", (value) => {
    expect(() => money(value)).toThrowError(MoneyError);
    try {
      money(value);
    } catch (error) {
      expect((error as MoneyError).code).toBe("NOT_AN_INTEGER");
    }
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrowError(/safe integer/);
  });

  it("explicitly allows negative amounts for discount and refund lines", () => {
    expect(money(-2_000).amountCents).toBe(-2_000);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and multiplies", () => {
    expect(add(money(1_500), money(150)).amountCents).toBe(1_650);
    expect(subtract(money(1_500), money(2_000)).amountCents).toBe(-500);
    expect(multiply(money(150), 12).amountCents).toBe(1_800);
  });

  it("sums a list, including the empty list", () => {
    expect(sum([money(100), money(250), money(-50)]).amountCents).toBe(300);
    expect(sum([]).amountCents).toBe(0);
  });

  it("refuses a fractional quantity", () => {
    expect(() => multiply(money(150), 1.5)).toThrowError(MoneyError);
  });

  it("refuses to combine different currencies", () => {
    const foreign = { amountCents: 100, currency: "USD" } as unknown as ReturnType<typeof money>;
    expect(() => add(money(100), foreign)).toThrowError(/Cannot combine EUR with USD/);
  });
});

describe("divideRounded", () => {
  const cases: Array<[number, number, RoundingMode, number]> = [
    // exact
    [100, 10, "halfUp", 10],
    // .5 boundaries
    [25, 10, "halfUp", 3],
    [25, 10, "halfEven", 2],
    [35, 10, "halfEven", 4],
    [-25, 10, "halfUp", -3],
    [-25, 10, "halfEven", -2],
    // floor / ceil on both signs
    [29, 10, "floor", 2],
    [-21, 10, "floor", -3],
    [21, 10, "ceil", 3],
    [-29, 10, "ceil", -2],
    // below / above half
    [24, 10, "halfUp", 2],
    [26, 10, "halfEven", 3],
  ];

  it.each(cases)("%i / %i with %s = %i", (numerator, denominator, mode, expected) => {
    expect(divideRounded(numerator, denominator, mode)).toBe(expected);
  });

  it("rejects a non-positive denominator", () => {
    expect(() => divideRounded(1, 0, "halfUp")).toThrowError(RangeError);
  });
});

describe("percentage", () => {
  it("computes basis points without floating point drift", () => {
    // 5.5 % of 10.05 EUR = 55.275 cents
    expect(percentage(money(1_005), 550, "halfUp").amountCents).toBe(55);
    expect(percentage(money(1_005), 550, "ceil").amountCents).toBe(56);
    // 10 % of 199.99 EUR
    expect(percentage(money(19_999), 1_000, "halfEven").amountCents).toBe(2_000);
  });

  it("refuses fractional basis points", () => {
    expect(() => percentage(money(1_000), 5.5, "halfUp")).toThrowError(MoneyError);
  });
});

describe("formatMoney", () => {
  it("formats in French", () => {
    // fr-FR uses a narrow no-break space for grouping and a no-break space before €
    expect(formatMoney(money(123_450), "fr")).toBe("1 234,50 €");
  });

  it("formats in English", () => {
    expect(formatMoney(money(123_450), "en")).toBe("€1,234.50");
  });

  it("formats negative amounts", () => {
    expect(formatMoney(money(-500), "en")).toBe("-€5.00");
  });
});
