import { z } from "zod";

import { ContactEmailSchema } from "@/domain/booking/contact";
import {
  BookingCustomerSchema,
  BookingTransportSchema,
  CustomerNotesSchema,
  type TransportKind,
} from "@/domain/booking/request-schema";
import type { QuoteRequestBody } from "@/lib/booking-quote";
import { PARIS_TIME_ZONE, resolveLocalDateTime } from "@/lib/dates";
import { CURRENCIES, money, type Money } from "@/lib/money";

/**
 * Browser side of the public request step (VTC-047): turns the contact details into a
 * `POST /api/v1/bookings` body and the answers of `POST /api/v1/payment-setups` and
 * `POST /api/v1/bookings` into what the page shows. Pure and framework-free, tested without a
 * browser. Validation uses the server's own schemas (`src/domain/booking/request-schema.ts`).
 *
 * No amount is computed here (BR-12): `displayedTotal` is the server total the visitor saw, sent
 * only so that the server can detect a price change. No card data ever reaches these functions:
 * the card stays in Stripe's Payment Element, only the SetupIntent id (`seti_…`) is sent (BR-40).
 */

/** The raw contact inputs of the request form, as strings from the controls. */
export type ContactDraft = Readonly<{
  name: string;
  email: string;
  phone: string;
  notes: string;
  /** Empty: no flight or train. */
  transportKind: "" | TransportKind;
  transportNumber: string;
  transportOrigin: string;
  transportTerminal: string;
  /** `YYYY-MM-DD` and `HH:MM`, wall-clock time in Europe/Paris. */
  transportDate: string;
  transportTime: string;
  termsAccepted: boolean;
}>;

export const EMPTY_CONTACT: ContactDraft = {
  name: "",
  email: "",
  phone: "",
  notes: "",
  transportKind: "",
  transportNumber: "",
  transportOrigin: "",
  transportTerminal: "",
  transportDate: "",
  transportTime: "",
  termsAccepted: false,
};

export const CONTACT_FIELDS = [
  "name",
  "email",
  "phone",
  "notes",
  "transportNumber",
  "transportOrigin",
  "transportTerminal",
  "transportScheduled",
  "terms",
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

type ValidatedContact = Readonly<{
  customer: z.output<typeof BookingCustomerSchema>;
  customerNotes: string | undefined;
  transport: z.output<typeof BookingTransportSchema> | undefined;
}>;

export type ContactResult =
  | { readonly ok: true; readonly contact: ValidatedContact }
  | { readonly ok: false; readonly issues: readonly ContactField[] };

/** Normalised email (trimmed, lower-cased), or null when it is not a valid address. */
export function normalisedEmail(email: string): string | null {
  const parsed = ContactEmailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

const blankToUndefined = (value: string) => (value.trim() === "" ? undefined : value);

/**
 * Scheduled arrival as an ISO instant, from the Paris wall-clock date and time. Both empty: none.
 * One of them only, a time skipped or repeated by a clock change: invalid (never shifted).
 */
function scheduledAt(date: string, time: string): { ok: true; value?: string } | { ok: false } {
  const d = date.trim();
  const t = time.trim();
  if (!d && !t) return { ok: true };
  if (!d || !t) return { ok: false };
  const resolved = resolveLocalDateTime(`${d}T${t}`, PARIS_TIME_ZONE);
  return resolved.kind === "exact"
    ? { ok: true, value: resolved.instant.toISOString() }
    : { ok: false };
}

/**
 * Validates the contact details with the server schemas, or lists the fields to fix. Every field
 * is checked, so the visitor sees all the problems at once.
 */
export function validateContact(draft: ContactDraft, locale: "fr" | "en"): ContactResult {
  const issues: ContactField[] = [];
  const phone = blankToUndefined(draft.phone);

  const customer = BookingCustomerSchema.safeParse({
    name: draft.name,
    email: draft.email,
    ...(phone === undefined ? {} : { phone }),
    locale,
  });
  if (!customer.success) {
    const failed = new Set(customer.error.issues.map((issue) => issue.path[0]));
    if (failed.has("name")) issues.push("name");
    if (failed.has("email")) issues.push("email");
    if (failed.has("phone")) issues.push("phone");
  }

  const notesInput = blankToUndefined(draft.notes);
  const notes = CustomerNotesSchema.safeParse(notesInput);
  if (!notes.success) issues.push("notes");

  let transport: z.output<typeof BookingTransportSchema> | undefined;
  if (draft.transportKind !== "") {
    const when = scheduledAt(draft.transportDate, draft.transportTime);
    if (!when.ok) issues.push("transportScheduled");
    const parsed = BookingTransportSchema.safeParse({
      kind: draft.transportKind,
      number: blankToUndefined(draft.transportNumber),
      origin: blankToUndefined(draft.transportOrigin),
      terminal: blankToUndefined(draft.transportTerminal),
      scheduledAt: when.ok ? when.value : undefined,
    });
    if (parsed.success) {
      transport = parsed.data;
    } else {
      const failed = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      if (failed.has("number")) issues.push("transportNumber");
      if (failed.has("origin")) issues.push("transportOrigin");
      if (failed.has("terminal")) issues.push("transportTerminal");
    }
  }

  if (!draft.termsAccepted) issues.push("terms");

  if (issues.length > 0 || !customer.success || !notes.success) return { ok: false, issues };
  return {
    ok: true,
    contact: { customer: customer.data, customerNotes: notes.data, transport },
  };
}

/** The body of `POST /api/v1/bookings` (docs/architecture/api.md). */
export type BookingRequestBody = Readonly<{
  origin: Readonly<{ label: string; placeId: string }>;
  destination: Readonly<{ label: string; placeId: string }>;
  pickupLocalDateTime: string;
  passengers: number;
  luggage: number;
  customer: ValidatedContact["customer"];
  customerNotes?: string;
  transport?: ValidatedContact["transport"];
  termsAccepted: true;
  displayedTotal: Money;
  paymentSetupId: string;
}>;

/**
 * Builds the booking request from the quote the visitor kept, the validated contact and the
 * confirmed SetupIntent. The places are sent as chosen in the autocomplete (id and label): the
 * server routes from the place id and stores the end points of the priced route (VTC-035).
 */
export function buildBookingRequest(input: {
  quoteRequest: QuoteRequestBody;
  contact: ValidatedContact;
  displayedTotal: Money;
  paymentSetupId: string;
}): BookingRequestBody {
  const { quoteRequest, contact } = input;
  return {
    origin: { label: quoteRequest.origin.label, placeId: quoteRequest.origin.placeId },
    destination: {
      label: quoteRequest.destination.label,
      placeId: quoteRequest.destination.placeId,
    },
    pickupLocalDateTime: quoteRequest.pickupLocalDateTime,
    passengers: quoteRequest.passengers,
    luggage: quoteRequest.luggage,
    customer: contact.customer,
    ...(contact.customerNotes === undefined ? {} : { customerNotes: contact.customerNotes }),
    ...(contact.transport === undefined ? {} : { transport: contact.transport }),
    termsAccepted: true,
    displayedTotal: {
      amountCents: input.displayedTotal.amountCents,
      currency: input.displayedTotal.currency,
    },
    paymentSetupId: input.paymentSetupId,
  };
}

const PaymentSetupResponseSchema = z.object({
  paymentSetup: z.object({ clientSecret: z.string().min(1) }),
});

/** The SetupIntent client secret of a 200 answer, or null when the body is malformed. */
export function readPaymentSetupResponse(body: unknown): string | null {
  const parsed = PaymentSetupResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.paymentSetup.clientSecret : null;
}

const BookingResponseSchema = z.object({
  booking: z.object({ reference: z.string().min(1).max(64), status: z.string().min(1) }),
});

/** The public reference of a 201 (created) or 200 (replay) answer, or null. */
export function readBookingResponse(body: unknown): string | null {
  const parsed = BookingResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.booking.reference : null;
}

/**
 * What the visitor is told when the request is not sent. Every error code of
 * `POST /api/v1/payment-setups` and `POST /api/v1/bookings` maps to one of these; unknown codes
 * and malformed bodies read as `unavailable`. None carries a technical detail or a Stripe message.
 */
export const REQUEST_FAILURES = [
  "invalidRequest",
  "invalidEmail",
  "timeNonexistent",
  "timeAmbiguous",
  "leadTime",
  "noRoute",
  "priceChanged",
  "requote",
  "cardMissing",
  "paymentRequired",
  "paymentUnavailable",
  "setupConflict",
  "cardUnexpected",
  "closed",
  "unavailable",
  "network",
] as const;
export type RequestFailure = (typeof REQUEST_FAILURES)[number];

/** Failures that point the visitor to direct contact (DEC-20). */
export const CONTACT_FAILURES: ReadonlySet<RequestFailure> = new Set<RequestFailure>([
  "leadTime",
  "noRoute",
  "closed",
  "unavailable",
]);

/** Error codes `POST /api/v1/bookings` can answer (docs/architecture/api.md). */
export const BOOKING_ERROR_CODES = [
  "NOT_FOUND",
  "INVALID_INPUT",
  "LOCAL_TIME_NONEXISTENT",
  "LOCAL_TIME_AMBIGUOUS",
  "BOOKING_LEAD_TIME_TOO_SHORT",
  "ROUTE_UNAVAILABLE",
  "PRICE_CHANGED",
  "PAYMENT_METHOD_REQUIRED",
  "PAYMENT_UNAVAILABLE",
  "NO_ACTIVE_PRICING_RULE",
  "PRICING_UNAVAILABLE",
  "BOOKING_REFERENCE_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

/** Error codes `POST /api/v1/payment-setups` can answer (docs/product/payments.md). */
export const PAYMENT_SETUP_ERROR_CODES = [
  "NOT_FOUND",
  "INVALID_INPUT",
  "PAYMENT_SETUP_CONFLICT",
  "PAYMENT_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const PriceChangedSchema = z.object({
  total: z.object({
    amountCents: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(CURRENCIES),
  }),
});

function errorCode(body: unknown): string | null {
  const parsed = ErrorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
}

export type BookingFailure = Readonly<{ failure: RequestFailure; total?: Money }>;

/**
 * Maps a non-2xx answer of `POST /api/v1/bookings`. `PRICE_CHANGED` carries the new server
 * total, shown for an explicit reconfirmation; without a readable total the visitor is asked to
 * quote again. `ROUTE_UNAVAILABLE` blames the trip only when it is a 422.
 */
export function bookingFailureOf(status: number, body: unknown): BookingFailure {
  switch (errorCode(body)) {
    case "INVALID_INPUT":
      return { failure: "invalidRequest" };
    case "LOCAL_TIME_NONEXISTENT":
      return { failure: "timeNonexistent" };
    case "LOCAL_TIME_AMBIGUOUS":
      return { failure: "timeAmbiguous" };
    case "BOOKING_LEAD_TIME_TOO_SHORT":
      return { failure: "leadTime" };
    case "ROUTE_UNAVAILABLE":
      return { failure: status === 422 ? "noRoute" : "unavailable" };
    case "PRICE_CHANGED": {
      const parsed = PriceChangedSchema.safeParse(body);
      if (!parsed.success) return { failure: "requote" };
      const { amountCents, currency } = parsed.data.total;
      return { failure: "priceChanged", total: money(amountCents, currency) };
    }
    case "PAYMENT_METHOD_REQUIRED":
      return { failure: "paymentRequired" };
    case "PAYMENT_UNAVAILABLE":
      return { failure: "paymentUnavailable" };
    case "NOT_FOUND":
      return { failure: "closed" };
    default:
      return { failure: "unavailable" };
  }
}

/** Maps a non-200 answer of `POST /api/v1/payment-setups`. */
export function paymentSetupFailureOf(body: unknown): RequestFailure {
  switch (errorCode(body)) {
    case "INVALID_INPUT":
      return "invalidEmail";
    case "PAYMENT_SETUP_CONFLICT":
      return "setupConflict";
    case "PAYMENT_UNAVAILABLE":
      return "paymentUnavailable";
    case "NOT_FOUND":
      return "closed";
    default:
      return "unavailable";
  }
}
