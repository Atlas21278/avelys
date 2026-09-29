import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { BookingCreationError } from "@/server/booking/create-booking";
import type { SubmittedBooking } from "@/server/booking/submit-booking";

// Only the production wiring is replaced: the route maps what the idempotent service returns or
// throws. The service itself is tested in src/server/booking (unit and integration).
const submitBookingRequest = vi.fn<(input: unknown) => Promise<SubmittedBooking>>();
const publicBookingEnabled = vi.fn(() => true);
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/server/booking/request-booking", () => ({
  submitBookingRequest: (input: unknown) => submitBookingRequest(input),
}));
vi.mock("@/server/public-booking", () => ({ publicBookingEnabled: () => publicBookingEnabled() }));
vi.mock("@/lib/logger", () => ({ logger: () => log }));

const { POST } = await import("./route");

const BODY = {
  origin: { label: "Test origin", lat: 48.8443, lng: 2.3743 },
  destination: { label: "Test destination", lat: 49.0097, lng: 2.5479 },
  pickupLocalDateTime: "2026-10-25T14:30",
  passengers: 2,
  luggage: 1,
  customer: { name: "Guest Test", email: "guest@avelys.test" },
  termsAccepted: true,
  displayedTotal: { amountCents: 4852, currency: "EUR" },
  paymentSetupId: "seti_Test123",
};

type ErrorBody = {
  error: { code: string; message: string; correlationId: string };
  total?: unknown;
};

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

async function refusal(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

beforeEach(() => {
  vi.clearAllMocks();
  publicBookingEnabled.mockReturnValue(true);
  submitBookingRequest.mockResolvedValue({
    reference: "VTC-TEST2345",
    status: "REQUESTED",
    replayed: false,
  });
});

describe("POST /api/v1/bookings", () => {
  it("answers 404 without calling the service when public booking is off (default)", async () => {
    publicBookingEnabled.mockReturnValue(false);
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(404);
    expect((await refusal(response)).error.code).toBe("NOT_FOUND");
    expect(submitBookingRequest).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the environment cannot be read", async () => {
    publicBookingEnabled.mockImplementation(() => {
      throw new Error("Invalid or missing environment variables: DATABASE_URL (invalid_type)");
    });
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(500);
    expect(submitBookingRequest).not.toHaveBeenCalled();
  });

  it("creates: 201 with the reference and status only, never cached", async () => {
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      booking: { reference: "VTC-TEST2345", status: "REQUESTED" },
    });
    expect(submitBookingRequest).toHaveBeenCalledWith(BODY);
  });

  it("replays: 200 with the same body for a second submission of the same form", async () => {
    submitBookingRequest.mockResolvedValue({
      reference: "VTC-TEST2345",
      status: "REQUESTED",
      replayed: true,
    });
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      booking: { reference: "VTC-TEST2345", status: "REQUESTED" },
    });
  });

  it("draws its own correlation id, ignoring the client's x-request-id", async () => {
    const response = await post("{not json", { "x-request-id": "client-chosen-id-123" });
    const body = await refusal(response);
    expect(body.error.correlationId).not.toBe("client-chosen-id-123");
    expect(body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).toBe(body.error.correlationId);
  });

  it("refuses invalid JSON with INVALID_INPUT, without calling the service", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect((await refusal(response)).error.code).toBe("INVALID_INPUT");
    expect(submitBookingRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_INPUT", false, 400],
    ["LOCAL_TIME_NONEXISTENT", false, 422],
    ["LOCAL_TIME_AMBIGUOUS", false, 422],
    ["BOOKING_LEAD_TIME_TOO_SHORT", false, 422],
    ["ROUTE_UNAVAILABLE", false, 422],
    ["ROUTE_UNAVAILABLE", true, 503],
    ["PAYMENT_METHOD_REQUIRED", false, 422],
    ["PAYMENT_UNAVAILABLE", true, 503],
    ["NO_ACTIVE_PRICING_RULE", false, 503],
    ["PRICING_UNAVAILABLE", false, 503],
    ["BOOKING_REFERENCE_UNAVAILABLE", false, 503],
    ["DATABASE_UNAVAILABLE", true, 503],
  ] as const)("maps %s (temporary: %s) to HTTP %i", async (code, temporary, status) => {
    submitBookingRequest.mockRejectedValue(
      new BookingCreationError(code, "test_reason", "test refusal", { temporary }),
    );
    const response = await post(JSON.stringify(BODY), { "accept-language": "en-GB" });
    expect(response.status).toBe(status);
    const body = await refusal(response);
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toBe("test refusal");
    expect(body.error.correlationId).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps PRICE_CHANGED to 409 with the new server total", async () => {
    submitBookingRequest.mockRejectedValue(
      new BookingCreationError("PRICE_CHANGED", "price_changed", "stale", {
        total: { amountCents: 5100, currency: "EUR" },
      }),
    );
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(409);
    const body = await refusal(response);
    expect(body.error.code).toBe("PRICE_CHANGED");
    expect(body.total).toEqual({ amountCents: 5100, currency: "EUR" });
  });

  it("answers PAYMENT_UNAVAILABLE with the catalogue message, never a Stripe message", async () => {
    submitBookingRequest.mockRejectedValue(
      new BookingCreationError("PAYMENT_UNAVAILABLE", "stripe_error", "unavailable", {
        temporary: true,
      }),
    );
    const response = await post(JSON.stringify(BODY));
    const body = await refusal(response);
    expect(response.status).toBe(503);
    expect(body.error.message).toBe(
      "L'enregistrement du moyen de paiement est momentanément indisponible. Aucun montant n'a été débité.",
    );
    expect(log.error).toHaveBeenCalledWith(
      { code: "PAYMENT_UNAVAILABLE", reason: "stripe_error", temporary: true },
      "booking request refused",
    );
  });

  it("maps an unreachable database to 503 DATABASE_UNAVAILABLE", async () => {
    submitBookingRequest.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Can't reach database server at guest", {
        code: "P1001",
        clientVersion: "test",
      }),
    );
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(503);
    expect((await refusal(response)).error.code).toBe("DATABASE_UNAVAILABLE");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("guest");
  });

  it("answers 500 INTERNAL_ERROR on an unexpected failure, logging its name only", async () => {
    submitBookingRequest.mockRejectedValue(new TypeError("guest@avelys.test Test origin"));
    const response = await post(JSON.stringify(BODY));
    expect(response.status).toBe(500);
    expect((await refusal(response)).error.code).toBe("INTERNAL_ERROR");
    expect(log.error).toHaveBeenCalledWith({ errorName: "TypeError" }, "booking request failed");
  });

  it("logs neither the email, a place nor a Stripe id", async () => {
    await post(JSON.stringify(BODY));
    submitBookingRequest.mockRejectedValue(
      new BookingCreationError("PAYMENT_METHOD_REQUIRED", "payment_setup_email_mismatch", "x"),
    );
    await post(JSON.stringify(BODY));
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logged).not.toMatch(/guest|Test origin|seti_/);
  });
});
