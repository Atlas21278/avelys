import { describe, expect, it } from "vitest";

import {
  BOOKING_ERROR_CODES,
  EMPTY_CONTACT,
  PAYMENT_SETUP_ERROR_CODES,
  REQUEST_FAILURES,
  bookingFailureOf,
  buildBookingRequest,
  normalisedEmail,
  paymentSetupFailureOf,
  readBookingResponse,
  readPaymentSetupResponse,
  validateContact,
  type ContactDraft,
} from "@/lib/booking-request";
import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";
import { money } from "@/lib/money";

const CONTACT: ContactDraft = {
  ...EMPTY_CONTACT,
  name: "  Guest Test ",
  email: " Guest@Avelys.TEST ",
  termsAccepted: true,
};

const QUOTE_REQUEST = {
  origin: { placeId: "test-place-origin", label: "Test origin" },
  destination: { placeId: "test-place-destination", label: "Test destination" },
  pickupLocalDateTime: "2026-10-25T14:30",
  passengers: 2,
  luggage: 1,
};

function valid(draft: ContactDraft) {
  const result = validateContact(draft, "fr");
  if (!result.ok) throw new Error(`unexpected issues: ${result.issues.join(",")}`);
  return result.contact;
}

describe("validateContact (server schemas, VTC-047)", () => {
  it("normalises the contact and takes the page language", () => {
    expect(valid(CONTACT).customer).toEqual({
      name: "Guest Test",
      email: "guest@avelys.test",
      locale: "fr",
    });
    const english = validateContact(CONTACT, "en");
    expect(english.ok && english.contact.customer.locale).toBe("en");
  });

  it("keeps the optional phone and notes only when filled", () => {
    const contact = valid({ ...CONTACT, phone: " +33 1 00 00 00 00 ", notes: "  Child seat " });
    expect(contact.customer.phone).toBe("+33 1 00 00 00 00");
    expect(contact.customerNotes).toBe("Child seat");
    expect(valid({ ...CONTACT, phone: "  ", notes: " " })).toMatchObject({
      customerNotes: undefined,
      customer: expect.not.objectContaining({ phone: expect.anything() }),
    });
  });

  it("lists every field to fix at once, the terms included", () => {
    const result = validateContact(
      { ...EMPTY_CONTACT, name: " ", email: "not-an-email", phone: "call me" },
      "fr",
    );
    expect(result).toEqual({ ok: false, issues: ["name", "email", "phone", "terms"] });
  });

  it("refuses notes longer than the server accepts", () => {
    const result = validateContact({ ...CONTACT, notes: "x".repeat(1_001) }, "fr");
    expect(result).toEqual({ ok: false, issues: ["notes"] });
  });

  it("ignores the transport fields while no flight or train is chosen", () => {
    expect(valid({ ...CONTACT, transportNumber: "AF1234" }).transport).toBeUndefined();
  });

  it("converts the scheduled arrival from Paris wall-clock time to an instant", () => {
    const contact = valid({
      ...CONTACT,
      transportKind: "FLIGHT",
      transportNumber: " AF1234 ",
      transportTerminal: "2E",
      transportDate: "2026-10-25",
      transportTime: "14:10",
    });
    expect(contact.transport).toEqual({
      kind: "FLIGHT",
      number: "AF1234",
      terminal: "2E",
      // 25 October 2026 is winter time in Paris (UTC+1).
      scheduledAt: "2026-10-25T13:10:00.000Z",
    });
  });

  it.each([
    ["a date without a time", { transportDate: "2026-10-25" }],
    ["a time without a date", { transportTime: "14:10" }],
    [
      "a time skipped by the spring change",
      { transportDate: "2026-03-29", transportTime: "02:30" },
    ],
    [
      "a time repeated by the autumn change",
      { transportDate: "2026-10-25", transportTime: "02:30" },
    ],
  ])("refuses %s", (_label, patch) => {
    const result = validateContact({ ...CONTACT, transportKind: "TRAIN", ...patch }, "fr");
    expect(result).toEqual({ ok: false, issues: ["transportScheduled"] });
  });

  it("accepts a train without a scheduled time", () => {
    expect(valid({ ...CONTACT, transportKind: "TRAIN" }).transport).toEqual({ kind: "TRAIN" });
  });
});

describe("normalisedEmail", () => {
  it("trims and lower-cases a valid address, refuses the rest", () => {
    expect(normalisedEmail(" Guest@Avelys.TEST ")).toBe("guest@avelys.test");
    expect(normalisedEmail("guest@")).toBeNull();
  });
});

describe("buildBookingRequest", () => {
  const body = buildBookingRequest({
    quoteRequest: QUOTE_REQUEST,
    contact: valid(CONTACT),
    displayedTotal: money(4852),
    paymentSetupId: "seti_test",
  });

  it("sends the chosen places without coordinates, the quote inputs and the SetupIntent id", () => {
    expect(body).toEqual({
      origin: { label: "Test origin", placeId: "test-place-origin" },
      destination: { label: "Test destination", placeId: "test-place-destination" },
      pickupLocalDateTime: "2026-10-25T14:30",
      passengers: 2,
      luggage: 1,
      customer: { name: "Guest Test", email: "guest@avelys.test", locale: "fr" },
      termsAccepted: true,
      displayedTotal: { amountCents: 4852, currency: "EUR" },
      paymentSetupId: "seti_test",
    });
  });

  it("carries no price other than the displayed total, and no card data", () => {
    const text = JSON.stringify(body);
    for (const key of ["price", "totalTtcCents", "snapshotId", "clientSecret", "card", "cvc"]) {
      expect(text).not.toContain(`"${key}"`);
    }
  });
});

describe("response readers", () => {
  it("reads the client secret of a payment setup, null when malformed", () => {
    expect(readPaymentSetupResponse({ paymentSetup: { clientSecret: "seti_x_secret_y" } })).toBe(
      "seti_x_secret_y",
    );
    expect(readPaymentSetupResponse({ paymentSetup: {} })).toBeNull();
    expect(readPaymentSetupResponse(null)).toBeNull();
  });

  it("reads the public reference of a created or replayed request", () => {
    expect(
      readBookingResponse({ booking: { reference: "VTC-AB12CD34", status: "REQUESTED" } }),
    ).toBe("VTC-AB12CD34");
    expect(readBookingResponse({ booking: { status: "REQUESTED" } })).toBeNull();
  });
});

const error = (code: string, extra: object = {}) => ({
  error: { code, message: "server message", correlationId: "c" },
  ...extra,
});

describe("bookingFailureOf (every code of POST /api/v1/bookings)", () => {
  it.each([
    [404, "NOT_FOUND", "closed"],
    [400, "INVALID_INPUT", "invalidRequest"],
    [422, "LOCAL_TIME_NONEXISTENT", "timeNonexistent"],
    [422, "LOCAL_TIME_AMBIGUOUS", "timeAmbiguous"],
    [422, "BOOKING_LEAD_TIME_TOO_SHORT", "leadTime"],
    [422, "ROUTE_UNAVAILABLE", "noRoute"],
    [503, "ROUTE_UNAVAILABLE", "unavailable"],
    [409, "PRICE_CHANGED", "requote"],
    [422, "PAYMENT_METHOD_REQUIRED", "paymentRequired"],
    [503, "PAYMENT_UNAVAILABLE", "paymentUnavailable"],
    [503, "NO_ACTIVE_PRICING_RULE", "unavailable"],
    [503, "PRICING_UNAVAILABLE", "unavailable"],
    [503, "BOOKING_REFERENCE_UNAVAILABLE", "unavailable"],
    [503, "DATABASE_UNAVAILABLE", "unavailable"],
    [500, "INTERNAL_ERROR", "unavailable"],
    [500, "SOMETHING_NEW", "unavailable"],
  ])("%i %s → %s", (status, code, failure) => {
    expect(bookingFailureOf(status, error(code))).toEqual({ failure });
  });

  it("covers every documented code", () => {
    for (const code of BOOKING_ERROR_CODES) {
      expect(REQUEST_FAILURES).toContain(bookingFailureOf(422, error(code)).failure);
    }
  });

  it("carries the new server total of PRICE_CHANGED for reconfirmation", () => {
    expect(
      bookingFailureOf(
        409,
        error("PRICE_CHANGED", { total: { amountCents: 5100, currency: "EUR" } }),
      ),
    ).toEqual({ failure: "priceChanged", total: money(5100) });
  });

  it("never trusts a malformed total", () => {
    expect(
      bookingFailureOf(
        409,
        error("PRICE_CHANGED", { total: { amountCents: 51.5, currency: "EUR" } }),
      ),
    ).toEqual({ failure: "requote" });
  });

  it("reads a body that is not an API error as unavailable", () => {
    expect(bookingFailureOf(502, "<html>")).toEqual({ failure: "unavailable" });
  });
});

describe("paymentSetupFailureOf (every code of POST /api/v1/payment-setups)", () => {
  it.each([
    ["NOT_FOUND", "closed"],
    ["INVALID_INPUT", "invalidEmail"],
    ["PAYMENT_SETUP_CONFLICT", "setupConflict"],
    ["PAYMENT_UNAVAILABLE", "paymentUnavailable"],
    ["INTERNAL_ERROR", "unavailable"],
  ] as const)("%s → %s", (code, failure) => {
    expect(PAYMENT_SETUP_ERROR_CODES).toContain(code);
    expect(paymentSetupFailureOf(error(code))).toBe(failure);
  });
});

describe("messages", () => {
  it.each([
    ["fr", fr],
    ["en", en],
  ])("has a %s message for every failure", (_locale, messages) => {
    const failures = messages.Pages.booking.request.failures as Record<string, string>;
    for (const failure of REQUEST_FAILURES) {
      expect(failures[failure], failure).toBeTruthy();
    }
  });
});
