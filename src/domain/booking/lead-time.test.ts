import { describe, expect, it } from "vitest";

import { earliestBookablePickup, meetsLeadTime } from "./lead-time";

// Arbitrary test lead time, not the business value (BR-31 is configured, not coded).
const LEAD_MINUTES = 90;
const NOW = new Date("2026-09-28T10:00:00.000Z");
const LIMIT = new Date("2026-09-28T11:30:00.000Z");
const at = (delta: number) => new Date(LIMIT.getTime() + delta);

describe("booking lead time", () => {
  it("computes the earliest bookable pickup", () => {
    expect(earliestBookablePickup(NOW, LEAD_MINUTES)).toEqual(LIMIT);
    expect(earliestBookablePickup(NOW, 0)).toEqual(NOW);
  });

  it("refuses a pickup just before the limit", () => {
    expect(meetsLeadTime(at(-1), NOW, LEAD_MINUTES)).toBe(false);
  });

  it("accepts a pickup exactly at the limit and just after it", () => {
    expect(meetsLeadTime(at(0), NOW, LEAD_MINUTES)).toBe(true);
    expect(meetsLeadTime(at(1), NOW, LEAD_MINUTES)).toBe(true);
  });

  it("refuses a pickup in the past", () => {
    expect(meetsLeadTime(new Date("2026-09-27T10:00:00.000Z"), NOW, 0)).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN])("rejects an invalid lead time %s", (value) => {
    expect(() => earliestBookablePickup(NOW, value)).toThrow(RangeError);
  });
});
