import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  BookingCreationError,
  type CreateBookingDeps,
  type CreatedBooking,
} from "./create-booking";

const createBooking = vi.fn<(input: unknown, deps: CreateBookingDeps) => Promise<CreatedBooking>>();
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// The creation service is replaced (it has its own tests); parsing and errors stay real.
vi.mock("./create-booking", async (importActual) => {
  const actual: Record<string, unknown> = await importActual();
  return {
    ...actual,
    createBooking: (input: unknown, deps: CreateBookingDeps) => createBooking(input, deps),
  };
});
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const { submitBooking } = await import("./submit-booking");

const findUnique = vi.fn();
const deps = {
  quote: vi.fn(),
  paymentMethodGuard: { confirmedPaymentMethod: vi.fn() },
  generateReference: vi.fn(),
  db: { payment: { findUnique } } as unknown as PrismaClient,
} satisfies CreateBookingDeps;

const REQUEST = {
  origin: { label: "Test origin", lat: 48.8443, lng: 2.3743 },
  destination: { label: "Test destination", lat: 49.0097, lng: 2.5479 },
  pickupLocalDateTime: "2026-10-25T14:30",
  passengers: 2,
  luggage: 1,
  customer: { name: "Guest Test", email: " Guest@Avelys.TEST " },
  termsAccepted: true,
  displayedTotal: { amountCents: 4852, currency: "EUR" },
  paymentSetupId: "seti_Test123",
};

const CREATED: CreatedBooking = {
  bookingId: "booking-1",
  reference: "VTC-TEST2345",
  status: "REQUESTED",
  customerId: "customer-1",
  paymentId: "payment-1",
  total: { amountCents: 4852, currency: "EUR" },
};

function prior(email: string, status = "REQUESTED") {
  return { booking: { reference: "VTC-PRIOR234", status, customer: { email } } };
}

async function refusal(input: unknown): Promise<BookingCreationError> {
  const error: unknown = await submitBooking(input, deps).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BookingCreationError);
  return error as BookingCreationError;
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  createBooking.mockResolvedValue(CREATED);
});

describe("submitBooking (idempotent public submission)", () => {
  it("creates a booking when the SetupIntent backs none", async () => {
    await expect(submitBooking(REQUEST, deps)).resolves.toEqual({
      reference: "VTC-TEST2345",
      status: "REQUESTED",
      replayed: false,
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSetupIntentId: "seti_Test123" } }),
    );
    expect(createBooking).toHaveBeenCalledWith(REQUEST, deps);
  });

  it("replays the booking of the same SetupIntent and email, without creating anything", async () => {
    findUnique.mockResolvedValue(prior("guest@avelys.test", "ACCEPTED"));
    await expect(submitBooking(REQUEST, deps)).resolves.toEqual({
      reference: "VTC-PRIOR234",
      status: "ACCEPTED",
      replayed: true,
    });
    expect(createBooking).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      { bookingRef: "VTC-PRIOR234" },
      "booking request replayed",
    );
  });

  it("refuses a SetupIntent that backs another email's booking, without creating anything", async () => {
    findUnique.mockResolvedValue(prior("other@avelys.test"));
    const error = await refusal(REQUEST);
    expect(error.code).toBe("PAYMENT_METHOD_REQUIRED");
    expect(error.reason).toBe("payment_setup_already_used");
    expect(createBooking).not.toHaveBeenCalled();
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/avelys\.test|seti_/);
  });

  it("refuses an invalid request before reading the database", async () => {
    const error = await refusal({ ...REQUEST, amountCents: 1 });
    expect(error.code).toBe("INVALID_INPUT");
    expect(findUnique).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("skips the replay lookup without a paymentSetupId", async () => {
    await submitBooking({ ...REQUEST, paymentSetupId: undefined }, deps);
    expect(findUnique).not.toHaveBeenCalled();
    expect(createBooking).toHaveBeenCalled();
  });

  it("answers with the winner's booking after losing a concurrent submission", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(prior("guest@avelys.test"));
    createBooking.mockRejectedValue(
      new BookingCreationError("PAYMENT_METHOD_REQUIRED", "payment_setup_already_used", "used"),
    );
    await expect(submitBooking(REQUEST, deps)).resolves.toEqual({
      reference: "VTC-PRIOR234",
      status: "REQUESTED",
      replayed: true,
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("keeps a payment method refusal when no booking uses the SetupIntent", async () => {
    createBooking.mockRejectedValue(
      new BookingCreationError("PAYMENT_METHOD_REQUIRED", "no_confirmed_payment_method", "none"),
    );
    const error = await refusal(REQUEST);
    expect(error.reason).toBe("no_confirmed_payment_method");
  });

  it("does not look for a replay after any other refusal", async () => {
    createBooking.mockRejectedValue(
      new BookingCreationError("PAYMENT_UNAVAILABLE", "stripe_error", "down", { temporary: true }),
    );
    const error = await refusal(REQUEST);
    expect(error.code).toBe("PAYMENT_UNAVAILABLE");
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
