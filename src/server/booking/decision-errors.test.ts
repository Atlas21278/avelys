import { describe, expect, it } from "vitest";

import { InvalidBookingTransitionError } from "@/domain/booking/transitions";
import { Prisma } from "@/generated/prisma/client";

import { BookingDecisionError } from "./decide-booking";
import {
  BookingDecisionInputSchema,
  DECISION_ERROR_MESSAGES,
  decisionError,
  decisionErrorCode,
} from "./decision-errors";

describe("BookingDecisionInputSchema", () => {
  it("accepts a reference and a positive version sent as form text", () => {
    expect(
      BookingDecisionInputSchema.parse({ reference: " VTC-7K2M9QXB ", expectedVersion: "3" }),
    ).toEqual({ reference: "VTC-7K2M9QXB", expectedVersion: 3 });
  });

  it.each([
    ["a missing reference", { reference: null, expectedVersion: "1" }],
    ["an empty reference", { reference: "  ", expectedVersion: "1" }],
    ["a missing version", { reference: "VTC-7K2M9QXB", expectedVersion: null }],
    ["a zero version", { reference: "VTC-7K2M9QXB", expectedVersion: "0" }],
    ["a decimal version", { reference: "VTC-7K2M9QXB", expectedVersion: "1.5" }],
    ["a non-numeric version", { reference: "VTC-7K2M9QXB", expectedVersion: "abc" }],
    ["an out-of-range version", { reference: "VTC-7K2M9QXB", expectedVersion: "3000000000" }],
    ["a target status", { reference: "VTC-7K2M9QXB", expectedVersion: "1", status: "ACCEPTED" }],
    ["an actor", { reference: "VTC-7K2M9QXB", expectedVersion: "1", actor: "ADMIN" }],
  ])("refuses %s", (_label, input) => {
    expect(BookingDecisionInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("decisionErrorCode", () => {
  it("maps a refused transition to INVALID_BOOKING_TRANSITION", () => {
    expect(
      decisionErrorCode(new InvalidBookingTransitionError("ACCEPTED", "REFUSED", "ADMIN")),
    ).toBe("INVALID_BOOKING_TRANSITION");
  });

  it.each(["BOOKING_NOT_FOUND", "BOOKING_CONCURRENT_UPDATE"] as const)("keeps %s", (code) => {
    expect(decisionErrorCode(new BookingDecisionError(code, "test"))).toBe(code);
  });

  it("maps an unreachable database to DATABASE_UNAVAILABLE", () => {
    const error = new Prisma.PrismaClientKnownRequestError("unreachable", {
      code: "P1001",
      clientVersion: "test",
    });
    expect(decisionErrorCode(error)).toBe("DATABASE_UNAVAILABLE");
  });

  it("maps anything else to INTERNAL_ERROR", () => {
    expect(decisionErrorCode(new Error("boom"))).toBe("INTERNAL_ERROR");
    expect(decisionErrorCode("boom")).toBe("INTERNAL_ERROR");
  });
});

describe("decisionError", () => {
  it("returns { code, message, correlationId } with the French message", () => {
    expect(decisionError("BOOKING_CONCURRENT_UPDATE", "corr-12345678")).toEqual({
      code: "BOOKING_CONCURRENT_UPDATE",
      message: DECISION_ERROR_MESSAGES.BOOKING_CONCURRENT_UPDATE,
      correlationId: "corr-12345678",
    });
  });

  it("has a non-empty message for every code, without internal detail", () => {
    for (const message of Object.values(DECISION_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/prisma|stack|sql|exception/i);
    }
  });
});
