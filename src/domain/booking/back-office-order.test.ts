import { describe, expect, it } from "vitest";

import { splitPriorityPage } from "./back-office-order";

describe("splitPriorityPage", () => {
  it("takes the whole page from the priority segment while it lasts", () => {
    expect(splitPriorityPage(50, 0, 20)).toEqual({ priority: { skip: 0, take: 20 }, rest: null });
    expect(splitPriorityPage(50, 20, 20)).toEqual({ priority: { skip: 20, take: 20 }, rest: null });
  });

  it("fills the page with the rest once the priority segment runs out", () => {
    expect(splitPriorityPage(25, 20, 20)).toEqual({
      priority: { skip: 20, take: 5 },
      rest: { skip: 0, take: 15 },
    });
  });

  it("skips the rows of the rest already shown on previous pages", () => {
    expect(splitPriorityPage(25, 40, 20)).toEqual({ priority: null, rest: { skip: 15, take: 20 } });
  });

  it("switches segments exactly at a page boundary", () => {
    expect(splitPriorityPage(20, 0, 20)).toEqual({ priority: { skip: 0, take: 20 }, rest: null });
    expect(splitPriorityPage(20, 20, 20)).toEqual({ priority: null, rest: { skip: 0, take: 20 } });
  });

  it("reads only the rest when there is no priority row", () => {
    expect(splitPriorityPage(0, 0, 20)).toEqual({ priority: null, rest: { skip: 0, take: 20 } });
  });

  it("covers every position once across consecutive pages", () => {
    const priorityCount = 7;
    const seen: string[] = [];
    for (let offset = 0; offset < 30; offset += 4) {
      const { priority, rest } = splitPriorityPage(priorityCount, offset, 4);
      for (let i = 0; i < (priority?.take ?? 0); i += 1) seen.push(`p${(priority?.skip ?? 0) + i}`);
      for (let i = 0; i < (rest?.take ?? 0); i += 1) seen.push(`r${(rest?.skip ?? 0) + i}`);
    }
    const expected = [
      ...Array.from({ length: priorityCount }, (_, i) => `p${i}`),
      ...Array.from({ length: 32 - priorityCount }, (_, i) => `r${i}`),
    ];
    expect(seen).toEqual(expected);
  });

  it("returns nothing for an empty page and rejects invalid inputs", () => {
    expect(splitPriorityPage(10, 0, 0)).toEqual({ priority: null, rest: null });
    expect(() => splitPriorityPage(-1, 0, 20)).toThrow(RangeError);
    expect(() => splitPriorityPage(0, 1.5, 20)).toThrow(RangeError);
    expect(() => splitPriorityPage(0, 0, Number.NaN)).toThrow(RangeError);
  });
});
