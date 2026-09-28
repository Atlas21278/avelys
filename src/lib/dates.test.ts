import { describe, expect, it } from "vitest";

import {
  formatParisDate,
  formatParisDateTime,
  formatParisOffset,
  formatParisTime,
  isCalendarDate,
  parisDayEnd,
  parisDayStart,
  toParisCalendarDate,
} from "./dates";

const HOUR = 3_600_000;

describe("Paris display of UTC instants", () => {
  it("adds one hour in winter and two in summer", () => {
    expect(formatParisTime(new Date("2026-01-15T08:00:00Z"))).toBe("09:00");
    expect(formatParisTime(new Date("2026-07-15T08:00:00Z"))).toBe("10:00");
  });

  it("formats date and time in French", () => {
    expect(formatParisDate(new Date("2026-10-25T01:30:00Z"))).toBe("dim. 25 oct. 2026");
    expect(formatParisDateTime(new Date("2026-10-25T01:30:00Z"))).toBe("dim. 25 oct. 2026, 02:30");
  });

  it("rolls over to the next Paris day late in the UTC evening", () => {
    const instant = new Date("2026-12-31T23:30:00Z");
    expect(formatParisDateTime(instant)).toBe("ven. 1 janv. 2027, 00:30");
    expect(toParisCalendarDate(instant)).toBe("2027-01-01");
  });

  it("jumps from 02:00 to 03:00 on the last Sunday of March", () => {
    // 2026-03-29: 01:59 CET is followed by 03:00 CEST.
    expect(formatParisTime(new Date("2026-03-29T00:59:00Z"))).toBe("01:59");
    expect(formatParisTime(new Date("2026-03-29T01:00:00Z"))).toBe("03:00");
    expect(formatParisOffset(new Date("2026-03-29T00:59:00Z"))).toBe("UTC+01:00");
    expect(formatParisOffset(new Date("2026-03-29T01:00:00Z"))).toBe("UTC+02:00");
  });

  it("shows 02:30 twice on the last Sunday of October, told apart by the offset", () => {
    // 2026-10-25: 02:59 CEST is followed by 02:00 CET.
    const first = new Date("2026-10-25T00:30:00Z");
    const second = new Date("2026-10-25T01:30:00Z");
    expect(formatParisTime(first)).toBe("02:30");
    expect(formatParisTime(second)).toBe("02:30");
    expect(formatParisOffset(first)).toBe("UTC+02:00");
    expect(formatParisOffset(second)).toBe("UTC+01:00");
  });
});

describe("Paris calendar days as UTC ranges", () => {
  it("starts a winter day at 23:00 UTC the day before", () => {
    expect(parisDayStart("2026-01-15").toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(parisDayEnd("2026-01-15").toISOString()).toBe("2026-01-15T23:00:00.000Z");
  });

  it("starts a summer day at 22:00 UTC the day before", () => {
    expect(parisDayStart("2026-07-15").toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("gives the spring-forward day 23 hours", () => {
    const start = parisDayStart("2026-03-29");
    const end = parisDayEnd("2026-03-29");
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  it("gives the fall-back day 25 hours", () => {
    const start = parisDayStart("2026-10-25");
    const end = parisDayEnd("2026-10-25");
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("crosses month and year boundaries", () => {
    expect(parisDayEnd("2026-12-31").toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(parisDayEnd("2028-02-28").toISOString()).toBe("2028-02-28T23:00:00.000Z");
    expect(parisDayStart("2028-02-29").toISOString()).toBe("2028-02-28T23:00:00.000Z");
  });

  it("rejects malformed or non-existent dates", () => {
    for (const value of ["2026-02-30", "2027-02-29", "2026-13-01", "26-01-01", "2026-1-5", ""]) {
      expect(isCalendarDate(value)).toBe(false);
      expect(() => parisDayStart(value)).toThrow(RangeError);
    }
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });
});
