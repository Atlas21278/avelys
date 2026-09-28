import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeBaseFare } from "@/domain/pricing/base-fare";
import { PROVISIONAL_RULE, route } from "@/domain/pricing/fixtures";
import { buildPricingSnapshot } from "@/domain/pricing/snapshot";
import type { PrismaClient } from "@/generated/prisma/client";
import { QuoteError, type Quote, type QuoteRequest } from "@/server/quotes/quote";

import {
  BookingCreationError,
  createBooking,
  CreateBookingRequestSchema,
  type CreateBookingDeps,
} from "./create-booking";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const FARE = computeBaseFare(PROVISIONAL_RULE, route({ distanceMeters: 22_345 }));

function sampleQuote(): Quote {
  const snapshot = buildPricingSnapshot({
    fare: FARE,
    quotedAt: new Date("2026-09-28T08:00:00.000Z"),
    inputs: {
      origin: { placeId: "test-place-origin" },
      destination: { lat: 49.0097, lng: 2.5479 },
      pickupLocalDateTime: "2026-10-02T14:30",
      timeZone: "Europe/Paris",
      pickupAt: "2026-10-02T12:30:00.000Z",
      passengers: 2,
      luggage: 1,
    },
  });
  return {
    snapshotId: "a".repeat(64),
    snapshot,
    total: FARE.total,
    totalHtCents: null,
    vatCents: null,
    pickupAt: new Date("2026-10-02T12:30:00.000Z"),
    origin: { placeId: "test-place-origin", label: "Test origin" },
    destination: { lat: 49.0097, lng: 2.5479, label: "Test destination" },
    pricedOrigin: { lat: 48.8584, lng: 2.2945 },
    pricedDestination: { lat: 49.0096, lng: 2.548 },
  };
}

const REQUEST = {
  origin: { label: "Test origin", lat: 48.8443, lng: 2.3743, placeId: "test-place-origin" },
  destination: { label: "Test destination", lat: 49.0097, lng: 2.5479 },
  pickupLocalDateTime: "2026-10-02T14:30",
  passengers: 2,
  luggage: 1,
  customer: { name: "Guest Test", email: "  Guest@Avelys.TEST ", phone: "+33 1 00 00 00 00" },
  termsAccepted: true,
  displayedTotal: { amountCents: FARE.total.amountCents, currency: "EUR" },
  paymentSetupId: "test-setup",
};

const quote = vi.fn<(request: QuoteRequest) => Promise<Quote>>();
const hasConfirmedPaymentMethod = vi.fn<() => Promise<boolean>>();
const $transaction = vi.fn(() => Promise.reject(new Error("database must not be reached")));

function deps(): CreateBookingDeps {
  return {
    quote,
    paymentMethodGuard: { hasConfirmedPaymentMethod },
    generateReference: () => "VTC-7K2M9QXB",
    db: { $transaction } as unknown as PrismaClient,
  };
}

async function refusal(input: unknown): Promise<BookingCreationError> {
  const error: unknown = await createBooking(input, deps()).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BookingCreationError);
  expect($transaction).not.toHaveBeenCalled();
  return error as BookingCreationError;
}

beforeEach(() => {
  vi.clearAllMocks();
  quote.mockResolvedValue(sampleQuote());
  hasConfirmedPaymentMethod.mockResolvedValue(true);
});

describe("CreateBookingRequestSchema", () => {
  it("normalises the email, trims text and defaults the locale to French", () => {
    const parsed = CreateBookingRequestSchema.parse(REQUEST);
    expect(parsed.customer).toEqual({
      name: "Guest Test",
      email: "guest@avelys.test",
      phone: "+33 1 00 00 00 00",
      locale: "fr",
    });
  });

  it.each([
    ["a client price", { price: 100 }],
    ["a client total", { totalTtcCents: 100 }],
    ["a client snapshot id", { snapshotId: "a".repeat(64) }],
    ["a client snapshot", { pricingSnapshot: {} }],
  ])("refuses %s (BR-12)", (_label, extra) => {
    expect(CreateBookingRequestSchema.safeParse({ ...REQUEST, ...extra }).success).toBe(false);
  });

  it.each([
    ["terms not accepted", { termsAccepted: false }],
    ["terms missing", { termsAccepted: undefined }],
    ["an invalid email", { customer: { ...REQUEST.customer, email: "not-an-email" } }],
    ["an empty name", { customer: { ...REQUEST.customer, name: "  " } }],
    ["an invalid phone", { customer: { ...REQUEST.customer, phone: "call me" } }],
    ["no passenger", { passengers: 0 }],
    ["a fractional amount", { displayedTotal: { amountCents: 10.5, currency: "EUR" } }],
    ["an unknown currency", { displayedTotal: { amountCents: 100, currency: "USD" } }],
    ["a place without coordinates", { origin: { label: "x", placeId: "p" } }],
    ["an unknown transport kind", { transport: { kind: "BUS" } }],
    [
      "a transport time without offset",
      { transport: { kind: "FLIGHT", scheduledAt: "2026-10-02T14:30" } },
    ],
  ])("refuses %s", (_label, override) => {
    expect(CreateBookingRequestSchema.safeParse({ ...REQUEST, ...override }).success).toBe(false);
  });

  it("accepts a flight arrival and customer notes", () => {
    const parsed = CreateBookingRequestSchema.parse({
      ...REQUEST,
      customerNotes: "  Child seat  ",
      transport: {
        kind: "FLIGHT",
        number: "AF1234",
        terminal: "2E",
        scheduledAt: "2026-10-02T14:10:00+02:00",
      },
    });
    expect(parsed.customerNotes).toBe("Child seat");
    expect(parsed.transport?.number).toBe("AF1234");
  });
});

describe("createBooking refusals (nothing written)", () => {
  it("maps an invalid request to INVALID_INPUT without values in the message", async () => {
    const error = await refusal({ ...REQUEST, customer: { ...REQUEST.customer, email: "x" } });
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).not.toContain("guest");
    expect(quote).not.toHaveBeenCalled();
  });

  it("prices through the server quote with the place id when present, coordinates otherwise", async () => {
    await createBooking(
      { ...REQUEST, displayedTotal: { amountCents: 1, currency: "EUR" } },
      deps(),
    ).catch(() => undefined);
    expect(quote).toHaveBeenCalledWith({
      origin: { placeId: "test-place-origin", label: "Test origin" },
      destination: { lat: 49.0097, lng: 2.5479, label: "Test destination" },
      pickupLocalDateTime: "2026-10-02T14:30",
      passengers: 2,
      luggage: 1,
    });
  });

  it("refuses with PRICE_CHANGED and the recomputed price when the displayed amount differs", async () => {
    const error = await refusal({
      ...REQUEST,
      displayedTotal: { amountCents: FARE.total.amountCents - 1, currency: "EUR" },
    });
    expect(error.code).toBe("PRICE_CHANGED");
    expect(error.details.total).toEqual(FARE.total);
    expect(hasConfirmedPaymentMethod).not.toHaveBeenCalled();
  });

  it("refuses with PAYMENT_METHOD_REQUIRED when the guard finds no confirmed method", async () => {
    hasConfirmedPaymentMethod.mockResolvedValue(false);
    const error = await refusal(REQUEST);
    expect(error.code).toBe("PAYMENT_METHOD_REQUIRED");
    expect(hasConfirmedPaymentMethod).toHaveBeenCalledWith({ paymentSetupId: "test-setup" });
  });

  it.each([
    ["BOOKING_LEAD_TIME_TOO_SHORT", false],
    ["ROUTE_UNAVAILABLE", true],
    ["NO_ACTIVE_PRICING_RULE", false],
  ] as const)("passes the quote refusal %s through", async (code, temporary) => {
    quote.mockRejectedValue(new QuoteError(code, "test", "test refusal", temporary));
    const error = await refusal(REQUEST);
    expect(error.code).toBe(code);
    expect(error.details.temporary).toBe(temporary);
    expect(error.cause).toBeInstanceOf(QuoteError);
  });
});
