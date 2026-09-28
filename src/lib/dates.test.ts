import { describe, expect, it } from "vitest";

import { PARIS_TIME_ZONE, parseLocalDateTime, resolveLocalDateTime } from "./dates";

const resolve = (value: string) => resolveLocalDateTime(value, PARIS_TIME_ZONE);
const exact = (iso: string) => ({ kind: "exact", instant: new Date(iso) });

describe("parseLocalDateTime", () => {
  it("reads a wall-clock time as a naive UTC timestamp", () => {
    expect(parseLocalDateTime("2026-10-25T02:30")).toBe(Date.UTC(2026, 9, 25, 2, 30));
  });

  it.each([
    "2026-02-30T10:00",
    "2026-13-01T10:00",
    "2026-01-01T24:00",
    "2026-01-01T10:60",
    "2026-01-01 10:00",
    "2026-01-01T10:00:00",
    "2026-01-01T10:00Z",
    "2026-01-01T10:00+01:00",
    "",
  ])("rejects %j", (value) => {
    expect(parseLocalDateTime(value)).toBeNull();
  });
});

describe("resolveLocalDateTime (Europe/Paris)", () => {
  it("converts winter (UTC+1) and summer (UTC+2) times", () => {
    expect(resolve("2026-01-15T12:00")).toEqual(exact("2026-01-15T11:00:00.000Z"));
    expect(resolve("2026-07-01T12:00")).toEqual(exact("2026-07-01T10:00:00.000Z"));
  });

  describe("last Sunday of March 2026 (29th): 02:00 jumps to 03:00", () => {
    it("keeps the minute before the gap", () => {
      expect(resolve("2026-03-29T01:59")).toEqual(exact("2026-03-29T00:59:00.000Z"));
    });

    it.each(["2026-03-29T02:00", "2026-03-29T02:30", "2026-03-29T02:59"])(
      "reports %s as nonexistent",
      (value) => {
        expect(resolve(value)).toEqual({ kind: "nonexistent" });
      },
    );

    it("resumes at 03:00 in summer time", () => {
      expect(resolve("2026-03-29T03:00")).toEqual(exact("2026-03-29T01:00:00.000Z"));
    });
  });

  describe("last Sunday of October 2026 (25th): 03:00 goes back to 02:00", () => {
    it("keeps the minute before the overlap", () => {
      expect(resolve("2026-10-25T01:59")).toEqual(exact("2026-10-24T23:59:00.000Z"));
    });

    it.each([
      ["2026-10-25T02:00", "2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z"],
      ["2026-10-25T02:30", "2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"],
      ["2026-10-25T02:59", "2026-10-25T00:59:00.000Z", "2026-10-25T01:59:00.000Z"],
    ])("reports %s as ambiguous, both instants in order", (value, first, second) => {
      expect(resolve(value)).toEqual({
        kind: "ambiguous",
        instants: [new Date(first), new Date(second)],
      });
    });

    it("resumes at 03:00 in winter time", () => {
      expect(resolve("2026-10-25T03:00")).toEqual(exact("2026-10-25T02:00:00.000Z"));
    });
  });

  it("reports malformed input as invalid", () => {
    expect(resolve("2026-02-30T10:00")).toEqual({ kind: "invalid" });
  });

  it("does not depend on the zone argument being Paris", () => {
    expect(resolveLocalDateTime("2026-07-01T12:00", "UTC")).toEqual(
      exact("2026-07-01T12:00:00.000Z"),
    );
  });
});
