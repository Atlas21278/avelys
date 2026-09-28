import { describe, expect, it } from "vitest";

import {
  BOOKING_LIST_MAX_PAGE,
  bookingListSearch,
  hasInvertedDateRange,
  parseBookingListQuery,
} from "./booking-list-query";

describe("parseBookingListQuery", () => {
  it("defaults to all statuses, no date range, first page", () => {
    expect(parseBookingListQuery({})).toEqual({ statuses: [], page: 1 });
  });

  it("reads one or several statuses, drops unknown ones and duplicates", () => {
    expect(parseBookingListQuery({ status: "REQUESTED" }).statuses).toEqual(["REQUESTED"]);
    expect(
      parseBookingListQuery({ status: ["CONFIRMED", "nope", "REQUESTED", "CONFIRMED", "ON_TRIP"] })
        .statuses,
    ).toEqual(["REQUESTED", "CONFIRMED"]);
    // Case-sensitive: the URL carries the stored values.
    expect(parseBookingListQuery({ status: "requested" }).statuses).toEqual([]);
  });

  it("ignores an oversized status list", () => {
    expect(parseBookingListQuery({ status: Array(50).fill("REQUESTED") }).statuses).toEqual([]);
  });

  it("keeps existing calendar dates and drops anything else", () => {
    expect(parseBookingListQuery({ from: "2026-10-25", to: " 2026-10-31 " })).toMatchObject({
      from: "2026-10-25",
      to: "2026-10-31",
    });
    const invalid = parseBookingListQuery({ from: "2026-02-30", to: "31/10/2026" });
    expect(invalid).not.toHaveProperty("from");
    expect(invalid).not.toHaveProperty("to");
    expect(parseBookingListQuery({ from: ["2026-10-25", "2026-10-26"] }).from).toBe("2026-10-25");
  });

  it("bounds the page number and falls back to 1 when invalid", () => {
    expect(parseBookingListQuery({ page: "3" }).page).toBe(3);
    for (const value of ["0", "-2", "1.5", "abc", "", String(BOOKING_LIST_MAX_PAGE + 1)]) {
      expect(parseBookingListQuery({ page: value }).page).toBe(1);
    }
  });
});

describe("bookingListSearch", () => {
  it("round-trips a query through the URL", () => {
    const query = parseBookingListQuery({
      status: ["REQUESTED", "ACCEPTED"],
      from: "2026-10-01",
      to: "2026-10-31",
      page: "2",
    });
    const search = bookingListSearch(query);
    expect(search).toBe("?status=REQUESTED&status=ACCEPTED&from=2026-10-01&to=2026-10-31&page=2");

    const params = new URLSearchParams(search);
    expect(
      parseBookingListQuery({
        status: params.getAll("status"),
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
        page: params.get("page") ?? undefined,
      }),
    ).toEqual(query);
  });

  it("omits defaults", () => {
    expect(bookingListSearch({ statuses: [], page: 1 })).toBe("");
  });
});

describe("hasInvertedDateRange", () => {
  it("flags a range that starts after it ends", () => {
    expect(
      hasInvertedDateRange({ statuses: [], page: 1, from: "2026-10-26", to: "2026-10-25" }),
    ).toBe(true);
    expect(
      hasInvertedDateRange({ statuses: [], page: 1, from: "2027-01-01", to: "2026-12-31" }),
    ).toBe(true);
  });

  it("accepts a single day, an ordered range and open-ended ranges", () => {
    expect(
      hasInvertedDateRange({ statuses: [], page: 1, from: "2026-10-25", to: "2026-10-25" }),
    ).toBe(false);
    expect(
      hasInvertedDateRange({ statuses: [], page: 1, from: "2026-10-25", to: "2026-10-26" }),
    ).toBe(false);
    expect(hasInvertedDateRange({ statuses: [], page: 1, from: "2026-10-25" })).toBe(false);
    expect(hasInvertedDateRange({ statuses: [], page: 1, to: "2026-10-25" })).toBe(false);
    expect(hasInvertedDateRange({ statuses: [], page: 1 })).toBe(false);
  });
});
