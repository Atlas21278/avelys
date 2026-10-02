import {
  bookingFailureOf,
  buildBookingRequest,
  normalisedEmail,
  paymentSetupFailureOf,
  readBookingResponse,
  readPaymentSetupResponse,
  validateContact,
  type RequestFailure,
} from "@/lib/booking-request";
import type { RetainedQuote } from "@/lib/quote-step-state";
import {
  displayedTotalOf,
  requestStepReducer,
  type RequestStepAction,
  type RequestStepState,
} from "@/lib/request-step-state";

/**
 * Calls of the public request step (VTC-047), outside React so that the double-submission rules
 * are tested with a mocked `fetch` and a mocked Stripe.js confirmation. The store applies each
 * action synchronously: a second click reads the `pending` state the first one set, before
 * React renders again.
 */

export interface RequestStore {
  getState(): RequestStepState;
  dispatch(action: RequestStepAction): void;
  subscribe(listener: () => void): () => void;
}

export function createRequestStore(initial: RequestStepState): RequestStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = requestStepReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Outcome of the Stripe.js confirmation of the SetupIntent (`stripe.confirmSetup`). */
export type CardConfirmation =
  | { readonly ok: true; readonly paymentSetupId: string }
  /** `message`: Stripe's localised message for a card or input error, null otherwise. */
  | { readonly ok: false; readonly message: string | null };

export interface RequestFlowDeps {
  readonly store: RequestStore;
  readonly fetch: typeof fetch;
  readonly locale: "fr" | "en";
  /** `crypto.randomUUID()` in the browser. */
  readonly newId: () => string;
}

function post(deps: RequestFlowDeps, url: string, body: unknown): Promise<Response> {
  return deps.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": deps.locale },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/**
 * Card step: creates the SetupIntent for the email entered (`POST /api/v1/payment-setups` with
 * the `submissionId`), then the page mounts the Payment Element with its client secret. Only the
 * email and the journey id are sent. A no-op while a call is in flight or once a SetupIntent
 * exists.
 */
export async function startCardSetup(deps: RequestFlowDeps): Promise<void> {
  const { store } = deps;
  const state = store.getState();
  if (state.pending !== null || state.card.kind !== "none" || state.reference !== null) return;
  const email = normalisedEmail(state.contact.email);
  if (email === null) {
    store.dispatch({ type: "invalid", issues: ["email"] });
    return;
  }
  const { epoch, submissionId } = state;
  store.dispatch({ type: "setupStarted", epoch, email });
  if (store.getState().pending !== "setup") return;

  const failed = (failure: RequestFailure) =>
    store.dispatch({ type: "setupFailed", epoch, failure, submissionId: deps.newId() });

  let response: Response;
  try {
    response = await post(deps, "/api/v1/payment-setups", { email, submissionId });
  } catch {
    failed("network");
    return;
  }
  const body: unknown = await response.json().catch(() => null);
  const clientSecret = response.ok ? readPaymentSetupResponse(body) : null;
  if (clientSecret === null) {
    failed(response.ok ? "unavailable" : paymentSetupFailureOf(body));
    return;
  }
  store.dispatch({ type: "setupCreated", epoch, clientSecret });
}

/**
 * Sends the request: validates the contact, confirms the SetupIntent with Stripe.js if not done
 * yet (SCA in Stripe's own window when the bank asks for it), then `POST /api/v1/bookings` with
 * the SetupIntent id and the total the visitor saw. A no-op while a call is in flight: a double
 * click sends one request. A retry after an error reuses the confirmed SetupIntent.
 *
 * `acceptPrice` is the visitor's explicit confirmation of a new price after `PRICE_CHANGED`.
 */
export async function submitRequest(
  deps: RequestFlowDeps,
  input: {
    quote: RetainedQuote;
    confirmCard: (() => Promise<CardConfirmation>) | null;
    acceptPrice: boolean;
  },
): Promise<void> {
  const { store } = deps;
  const state = store.getState();
  if (state.pending !== null || state.reference !== null) return;
  if (state.fingerprint !== input.quote.fingerprint) return;

  const validated = validateContact(state.contact, deps.locale);
  if (!validated.ok) {
    store.dispatch({ type: "invalid", issues: validated.issues });
    return;
  }
  if (state.card.kind !== "entry" && state.card.kind !== "saved") {
    store.dispatch({ type: "blocked", failure: "cardMissing" });
    return;
  }

  const { epoch } = state;
  store.dispatch({ type: "submitStarted", epoch, acceptPrice: input.acceptPrice });
  const started = store.getState();
  if (started.pending !== "submit" || started.epoch !== epoch) return;

  let paymentSetupId: string;
  if (started.card.kind === "saved") {
    paymentSetupId = started.card.paymentSetupId;
  } else {
    if (input.confirmCard === null) {
      store.dispatch({ type: "cardFailed", epoch, message: null });
      return;
    }
    let confirmation: CardConfirmation;
    try {
      confirmation = await input.confirmCard();
    } catch {
      confirmation = { ok: false, message: null };
    }
    if (!confirmation.ok) {
      store.dispatch({ type: "cardFailed", epoch, message: confirmation.message });
      return;
    }
    store.dispatch({ type: "cardSaved", epoch, paymentSetupId: confirmation.paymentSetupId });
    paymentSetupId = confirmation.paymentSetupId;
  }

  const current = store.getState();
  if (current.epoch !== epoch || current.pending !== "submit") return;
  const body = buildBookingRequest({
    quoteRequest: input.quote.request,
    contact: validated.contact,
    displayedTotal: displayedTotalOf(current, input.quote.quote.total),
    paymentSetupId,
  });

  const failed = (failure: ReturnType<typeof bookingFailureOf>) =>
    store.dispatch({
      type: "submitFailed",
      epoch,
      failure: failure.failure,
      ...(failure.total ? { total: failure.total } : {}),
      submissionId: deps.newId(),
    });

  let response: Response;
  try {
    response = await post(deps, "/api/v1/bookings", body);
  } catch {
    failed({ failure: "network" });
    return;
  }
  const answer: unknown = await response.json().catch(() => null);
  const reference = response.ok ? readBookingResponse(answer) : null;
  if (reference === null) {
    failed(response.ok ? { failure: "unavailable" } : bookingFailureOf(response.status, answer));
    return;
  }
  store.dispatch({ type: "submitted", epoch, reference });
}
