/**
 * Keyboard model of a list-autocomplete combobox (WAI-ARIA APG "combobox with listbox popup"):
 * focus stays in the text field, the highlighted option is exposed with
 * `aria-activedescendant`. Pure so it can be tested without a DOM.
 */

export type ComboboxState = Readonly<{
  open: boolean;
  /** Highlighted option, or -1 when none. */
  activeIndex: number;
}>;

export const CLOSED_COMBOBOX: ComboboxState = Object.freeze({ open: false, activeIndex: -1 });

export type ComboboxKeyResult = Readonly<{
  state: ComboboxState;
  /** Index of the option to choose (Enter on a highlighted option). */
  choose?: number;
  /** The key was handled: the caller prevents its default action. */
  handled: boolean;
}>;

export function comboboxKey(state: ComboboxState, key: string, count: number): ComboboxKeyResult {
  switch (key) {
    case "ArrowDown":
      if (count === 0) return { state, handled: true };
      return {
        state: {
          open: true,
          activeIndex: !state.open || state.activeIndex >= count - 1 ? 0 : state.activeIndex + 1,
        },
        handled: true,
      };
    case "ArrowUp":
      if (count === 0) return { state, handled: true };
      return {
        state: {
          open: true,
          activeIndex: !state.open || state.activeIndex <= 0 ? count - 1 : state.activeIndex - 1,
        },
        handled: true,
      };
    case "Enter":
      if (state.open && state.activeIndex >= 0 && state.activeIndex < count) {
        return { state: CLOSED_COMBOBOX, choose: state.activeIndex, handled: true };
      }
      return { state, handled: false };
    case "Escape":
      if (state.open) return { state: CLOSED_COMBOBOX, handled: true };
      return { state, handled: false };
    case "Tab":
      return { state: CLOSED_COMBOBOX, handled: false };
    default:
      return { state, handled: false };
  }
}

/** Where the suggestions of a place field stand relative to what is typed in it. */
export type SuggestionStatus = "idle" | "loading" | "ready" | "failed";

/**
 * Number of options the keyboard may reach. Only a list that answers the current text counts:
 * while a new query loads, or after a failure, an older (hidden) list must never be chosen with
 * ArrowDown + Enter.
 */
export function reachableOptionCount(status: SuggestionStatus, count: number): number {
  return status === "ready" ? count : 0;
}
