import type { BookingSearch } from "@/lib/booking-search";
import {
  quoteFingerprint,
  type ChosenPlace,
  type DisplayQuote,
  type QuoteDraft,
  type QuoteDraftField,
  type QuoteFailure,
  type QuoteRequestBody,
} from "@/lib/booking-quote";

/**
 * State of the public quote step (VTC-046), as a pure reducer so its rules are tested without
 * a browser:
 *
 * - a place is valid only once chosen from the suggestions; typing again forgets the choice;
 * - any change of an input drops the displayed quote (the price shown always matches the
 *   inputs shown) and bumps `revision`;
 * - a response is applied only if no input changed since the request was sent;
 * - while a request is in flight, submitting again is a no-op (the button is disabled too).
 */

export type PlaceField = "pickup" | "dropoff";
export type PlainField = "date" | "time" | "passengers" | "luggage";

export type PlaceInput = Readonly<{ text: string; chosen: ChosenPlace | null }>;

/** A server quote kept for step 2 (VTC-047), with the exact request that produced it. */
export type RetainedQuote = Readonly<{
  request: QuoteRequestBody;
  quote: DisplayQuote;
  /** See `quoteFingerprint`: step 2 renews its SetupIntent and submissionId when it changes. */
  fingerprint: string;
}>;

export type QuoteOutcome =
  | { readonly kind: "quote"; readonly retained: RetainedQuote }
  | { readonly kind: "failure"; readonly failure: QuoteFailure };

export type QuoteStepState = Readonly<{
  pickup: PlaceInput;
  dropoff: PlaceInput;
  date: string;
  time: string;
  passengers: string;
  luggage: string;
  /** Incremented on every input change. */
  revision: number;
  /** Revision of the request in flight, or null. */
  pending: number | null;
  /** Fields to fix, from the last submit attempt. */
  issues: readonly QuoteDraftField[];
  outcome: QuoteOutcome | null;
}>;

export type QuoteStepAction =
  | { readonly type: "placeText"; readonly field: PlaceField; readonly text: string }
  | { readonly type: "placeChosen"; readonly field: PlaceField; readonly place: ChosenPlace }
  | { readonly type: "field"; readonly field: PlainField; readonly value: string }
  | { readonly type: "invalid"; readonly issues: readonly QuoteDraftField[] }
  | { readonly type: "submitted"; readonly revision: number }
  | {
      readonly type: "quoted";
      readonly revision: number;
      readonly request: QuoteRequestBody;
      readonly quote: DisplayQuote;
    }
  | { readonly type: "failed"; readonly revision: number; readonly failure: QuoteFailure };

/**
 * Initial state, pre-filled from the home page search. Its free-text places are shown but not
 * chosen: the visitor must confirm them from the suggestions.
 */
export function initialQuoteStepState(search: BookingSearch): QuoteStepState {
  return {
    pickup: { text: search.pickup ?? "", chosen: null },
    dropoff: { text: search.dropoff ?? "", chosen: null },
    date: search.date ?? "",
    time: search.time ?? "",
    passengers: String(search.passengers ?? 1),
    luggage: String(search.luggage ?? 0),
    revision: 0,
    pending: null,
    issues: [],
    outcome: null,
  };
}

/** An input changed: forget the quote and any request in flight. */
function edited(state: QuoteStepState, patch: Partial<QuoteStepState>, field: QuoteDraftField) {
  return {
    ...state,
    ...patch,
    revision: state.revision + 1,
    pending: null,
    issues: state.issues.filter((issue) => issue !== field),
    outcome: null,
  };
}

export function quoteStepReducer(state: QuoteStepState, action: QuoteStepAction): QuoteStepState {
  switch (action.type) {
    case "placeText": {
      const current = state[action.field];
      // Same text (e.g. a re-render echo): keep the choice and the quote.
      if (current.text === action.text) return state;
      return edited(state, { [action.field]: { text: action.text, chosen: null } }, action.field);
    }
    case "placeChosen": {
      const current = state[action.field].chosen;
      if (
        current?.placeId === action.place.placeId &&
        current.label === action.place.label &&
        state[action.field].text === action.place.label
      ) {
        return state;
      }
      return edited(
        state,
        { [action.field]: { text: action.place.label, chosen: action.place } },
        action.field,
      );
    }
    case "field":
      if (state[action.field] === action.value) return state;
      return edited(state, { [action.field]: action.value }, action.field);
    case "invalid":
      return { ...state, issues: action.issues, outcome: null };
    case "submitted":
      if (state.pending !== null || action.revision !== state.revision) return state;
      return { ...state, pending: action.revision, issues: [], outcome: null };
    case "quoted":
      if (state.pending !== action.revision || state.revision !== action.revision) return state;
      return {
        ...state,
        pending: null,
        outcome: {
          kind: "quote",
          retained: {
            request: action.request,
            quote: action.quote,
            fingerprint: quoteFingerprint(action.request, action.quote),
          },
        },
      };
    case "failed":
      if (state.pending !== action.revision || state.revision !== action.revision) return state;
      return { ...state, pending: null, outcome: { kind: "failure", failure: action.failure } };
  }
}

export function draftOf(state: QuoteStepState): QuoteDraft {
  return {
    pickup: state.pickup.chosen,
    dropoff: state.dropoff.chosen,
    date: state.date,
    time: state.time,
    passengers: state.passengers,
    luggage: state.luggage,
  };
}

/** True while a quote request is in flight: the submit button is disabled. */
export function isSubmitting(state: QuoteStepState): boolean {
  return state.pending !== null;
}

/** The quote step 2 may build on, or null when none matches the current inputs. */
export function retainedQuote(state: QuoteStepState): RetainedQuote | null {
  return state.outcome?.kind === "quote" ? state.outcome.retained : null;
}
