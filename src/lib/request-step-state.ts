import type { ContactDraft, ContactField, RequestFailure } from "@/lib/booking-request";
import { EMPTY_CONTACT } from "@/lib/booking-request";
import type { Money } from "@/lib/money";

/**
 * State of the public request step (VTC-047), as a pure reducer so its rules are tested without
 * a browser. Review notes of VTC-045 (avelys-private#102):
 *
 * - `submissionId` is a UUID v4 drawn by the browser (`crypto.randomUUID()`, passed in the
 *   actions so the reducer stays pure), kept client-side only. It is drawn again when the email
 *   changes before the card step starts, and whenever the card step is reset.
 * - Once a SetupIntent exists for an email, the email is locked: changing it restarts the card
 *   step (new `submissionId`, new SetupIntent).
 * - When the quote fingerprint (`quoteFingerprint`, step 1) changes, the card step restarts with
 *   a new `submissionId`: a replay with the old SetupIntent would return the reference of the
 *   previous trip.
 * - While a call is in flight (`pending`), every new submission is a no-op (the button is
 *   disabled too). A retry after a network error sends the same request (same SetupIntent),
 *   which the server deduplicates.
 * - After `PRICE_CHANGED`, nothing is sent until the visitor explicitly confirms the new price.
 *
 * `epoch` changes on every reset: an answer that belongs to an older epoch is ignored.
 */

export type CardStep =
  /** No SetupIntent yet: the email can still change. */
  | { readonly kind: "none" }
  /** `POST /api/v1/payment-setups` in flight. */
  | { readonly kind: "creating"; readonly email: string }
  /** Payment Element shown for this SetupIntent. */
  | { readonly kind: "entry"; readonly email: string; readonly clientSecret: string }
  /** SetupIntent confirmed by Stripe.js: only its id is sent with the request. */
  | { readonly kind: "saved"; readonly email: string; readonly paymentSetupId: string };

export type RequestStepState = Readonly<{
  /** Fingerprint of the quote this step belongs to, or null before the first quote. */
  fingerprint: string | null;
  submissionId: string;
  epoch: number;
  contact: ContactDraft;
  card: CardStep;
  /** `submit` covers the card confirmation and the booking request. */
  pending: "setup" | "submit" | null;
  issues: readonly ContactField[];
  failure: RequestFailure | null;
  /** Localised Stripe.js message of a card refusal, shown as is; never sent anywhere. */
  cardMessage: string | null;
  /** New server total of a `PRICE_CHANGED`, waiting for the visitor's confirmation. */
  priceChange: Money | null;
  /** New server total the visitor confirmed; replaces the quote total as `displayedTotal`. */
  acceptedTotal: Money | null;
  /** Public reference of the request sent (created or replayed). */
  reference: string | null;
}>;

export type TextContactField = Exclude<keyof ContactDraft, "termsAccepted" | "transportKind">;

export type RequestStepAction =
  | { readonly type: "quote"; readonly fingerprint: string; readonly submissionId: string }
  | {
      readonly type: "field";
      readonly field: TextContactField;
      readonly value: string;
      /** Fresh id, used when the email changes before the card step. */
      readonly submissionId: string;
    }
  | { readonly type: "transportKind"; readonly value: ContactDraft["transportKind"] }
  | { readonly type: "terms"; readonly accepted: boolean }
  | { readonly type: "changeEmail"; readonly submissionId: string }
  | { readonly type: "invalid"; readonly issues: readonly ContactField[] }
  | { readonly type: "blocked"; readonly failure: RequestFailure }
  | { readonly type: "setupStarted"; readonly epoch: number; readonly email: string }
  | { readonly type: "setupCreated"; readonly epoch: number; readonly clientSecret: string }
  | {
      readonly type: "setupFailed";
      readonly epoch: number;
      readonly failure: RequestFailure;
      readonly submissionId: string;
    }
  | { readonly type: "submitStarted"; readonly epoch: number; readonly acceptPrice: boolean }
  | { readonly type: "cardSaved"; readonly epoch: number; readonly paymentSetupId: string }
  | { readonly type: "cardFailed"; readonly epoch: number; readonly message: string | null }
  | { readonly type: "submitted"; readonly epoch: number; readonly reference: string }
  | {
      readonly type: "submitFailed";
      readonly epoch: number;
      readonly failure: RequestFailure;
      readonly total?: Money;
      readonly submissionId: string;
    };

export function initialRequestStepState(submissionId: string): RequestStepState {
  return {
    fingerprint: null,
    submissionId,
    epoch: 0,
    contact: EMPTY_CONTACT,
    card: { kind: "none" },
    pending: null,
    issues: [],
    failure: null,
    cardMessage: null,
    priceChange: null,
    acceptedTotal: null,
    reference: null,
  };
}

/** Back to "no card": new journey id, in-flight answers ignored, price confirmations dropped. */
function restartCard(state: RequestStepState, submissionId: string): RequestStepState {
  return {
    ...state,
    submissionId,
    epoch: state.epoch + 1,
    card: { kind: "none" },
    pending: null,
    failure: null,
    cardMessage: null,
    priceChange: null,
    acceptedTotal: null,
  };
}

const current = (state: RequestStepState, epoch: number) =>
  state.epoch === epoch && state.reference === null;

export function requestStepReducer(
  state: RequestStepState,
  action: RequestStepAction,
): RequestStepState {
  switch (action.type) {
    case "quote":
      if (state.reference !== null || state.fingerprint === action.fingerprint) return state;
      return { ...restartCard(state, action.submissionId), fingerprint: action.fingerprint };
    case "field": {
      if (state.reference !== null || state.contact[action.field] === action.value) return state;
      const issues = state.issues.filter((issue) => !fieldIssues(action.field).includes(issue));
      if (action.field === "email") {
        // Locked once a SetupIntent exists for it: `changeEmail` restarts the card step first.
        if (state.card.kind !== "none" || state.pending !== null) return state;
        return {
          ...state,
          contact: { ...state.contact, email: action.value },
          submissionId: action.submissionId,
          issues,
          failure: null,
        };
      }
      return { ...state, contact: { ...state.contact, [action.field]: action.value }, issues };
    }
    case "transportKind":
      if (state.reference !== null || state.contact.transportKind === action.value) return state;
      return {
        ...state,
        contact: { ...state.contact, transportKind: action.value },
        issues: state.issues.filter((issue) => !issue.startsWith("transport")),
      };
    case "terms":
      if (state.reference !== null) return state;
      return {
        ...state,
        contact: { ...state.contact, termsAccepted: action.accepted },
        issues: state.issues.filter((issue) => issue !== "terms"),
      };
    case "changeEmail":
      if (state.reference !== null || state.pending === "submit") return state;
      return restartCard(state, action.submissionId);
    case "invalid":
      return { ...state, issues: action.issues, failure: null };
    case "blocked":
      return { ...state, failure: action.failure };
    case "setupStarted":
      if (!current(state, action.epoch) || state.pending !== null || state.card.kind !== "none") {
        return state;
      }
      return {
        ...state,
        pending: "setup",
        card: { kind: "creating", email: action.email },
        issues: state.issues.filter((issue) => issue !== "email"),
        failure: null,
        cardMessage: null,
      };
    case "setupCreated":
      if (!current(state, action.epoch) || state.card.kind !== "creating") return state;
      return {
        ...state,
        pending: null,
        card: { kind: "entry", email: state.card.email, clientSecret: action.clientSecret },
      };
    case "setupFailed":
      if (!current(state, action.epoch) || state.card.kind !== "creating") return state;
      return {
        ...state,
        pending: null,
        card: { kind: "none" },
        failure: action.failure,
        // The same id with another email is refused by Stripe: draw a new one after a conflict.
        submissionId: action.failure === "setupConflict" ? action.submissionId : state.submissionId,
      };
    case "submitStarted": {
      if (!current(state, action.epoch) || state.pending !== null) return state;
      if (state.card.kind !== "entry" && state.card.kind !== "saved") return state;
      // A changed price is never sent without the visitor's explicit confirmation.
      if (state.priceChange !== null && !action.acceptPrice) return state;
      return {
        ...state,
        pending: "submit",
        issues: [],
        failure: null,
        cardMessage: null,
        acceptedTotal: state.priceChange ?? state.acceptedTotal,
        priceChange: null,
      };
    }
    case "cardSaved":
      if (!current(state, action.epoch) || state.pending !== "submit") return state;
      if (state.card.kind !== "entry") return state;
      return {
        ...state,
        card: { kind: "saved", email: state.card.email, paymentSetupId: action.paymentSetupId },
      };
    case "cardFailed":
      if (!current(state, action.epoch) || state.pending !== "submit") return state;
      return {
        ...state,
        pending: null,
        cardMessage: action.message,
        failure: action.message === null ? "cardUnexpected" : null,
      };
    case "submitted":
      if (!current(state, action.epoch) || state.pending !== "submit") return state;
      return { ...state, pending: null, reference: action.reference };
    case "submitFailed": {
      if (!current(state, action.epoch) || state.pending !== "submit") return state;
      if (action.failure === "paymentRequired") {
        // The saved card is not usable for this request: back to the card step, new journey.
        return { ...restartCard(state, action.submissionId), failure: "paymentRequired" };
      }
      return {
        ...state,
        pending: null,
        failure: action.failure,
        priceChange: action.failure === "priceChanged" ? (action.total ?? null) : null,
      };
    }
  }
}

function fieldIssues(field: TextContactField): readonly ContactField[] {
  switch (field) {
    case "transportDate":
    case "transportTime":
      return ["transportScheduled"];
    default:
      return [field];
  }
}

/** Email locked: a SetupIntent exists (or is being created) for it. */
export function isEmailLocked(state: RequestStepState): boolean {
  return state.card.kind !== "none";
}

/** The total sent as `displayedTotal`: the quote's, or the new price the visitor confirmed. */
export function displayedTotalOf(state: RequestStepState, quoteTotal: Money): Money {
  return state.acceptedTotal ?? quoteTotal;
}
