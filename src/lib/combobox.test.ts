import { describe, expect, it } from "vitest";

import { CLOSED_COMBOBOX, comboboxKey } from "./combobox";

describe("comboboxKey", () => {
  it("opens on the first option with ArrowDown and wraps at the end", () => {
    const first = comboboxKey(CLOSED_COMBOBOX, "ArrowDown", 3);
    expect(first).toEqual({ state: { open: true, activeIndex: 0 }, handled: true });
    const second = comboboxKey(first.state, "ArrowDown", 3).state;
    const third = comboboxKey(second, "ArrowDown", 3).state;
    expect(third.activeIndex).toBe(2);
    expect(comboboxKey(third, "ArrowDown", 3).state.activeIndex).toBe(0);
  });

  it("opens on the last option with ArrowUp and wraps at the start", () => {
    const last = comboboxKey(CLOSED_COMBOBOX, "ArrowUp", 3).state;
    expect(last).toEqual({ open: true, activeIndex: 2 });
    const top = comboboxKey({ open: true, activeIndex: 0 }, "ArrowUp", 3).state;
    expect(top.activeIndex).toBe(2);
  });

  it("does nothing on arrows without options", () => {
    expect(comboboxKey(CLOSED_COMBOBOX, "ArrowDown", 0).state).toEqual(CLOSED_COMBOBOX);
  });

  it("chooses the highlighted option with Enter and closes", () => {
    expect(comboboxKey({ open: true, activeIndex: 1 }, "Enter", 3)).toEqual({
      state: CLOSED_COMBOBOX,
      choose: 1,
      handled: true,
    });
  });

  it("lets Enter submit the form when no option is highlighted", () => {
    expect(comboboxKey({ open: true, activeIndex: -1 }, "Enter", 3)).toMatchObject({
      handled: false,
    });
    expect(comboboxKey(CLOSED_COMBOBOX, "Enter", 3).choose).toBeUndefined();
  });

  it("closes with Escape, and lets Escape through when already closed", () => {
    expect(comboboxKey({ open: true, activeIndex: 1 }, "Escape", 3)).toEqual({
      state: CLOSED_COMBOBOX,
      handled: true,
    });
    expect(comboboxKey(CLOSED_COMBOBOX, "Escape", 3).handled).toBe(false);
  });

  it("closes on Tab without trapping focus", () => {
    expect(comboboxKey({ open: true, activeIndex: 0 }, "Tab", 3)).toEqual({
      state: CLOSED_COMBOBOX,
      handled: false,
    });
  });
});
