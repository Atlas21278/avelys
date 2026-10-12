import { describe, expect, it } from "vitest";

import { BOOKING_STATUSES } from "../booking/status";
import {
  isRegularizationLinkUsable,
  regularizationStep,
  type RegularizationCandidate,
} from "./regularization";
import { PAYMENT_STATUSES } from "./status";

const NOW = new Date("2026-10-30T10:00:00Z");

function candidate(
  change: {
    claim?: Partial<RegularizationCandidate["claim"]>;
    payment?: Partial<NonNullable<RegularizationCandidate["payment"]>> | null;
    booking?: Partial<NonNullable<RegularizationCandidate["booking"]>> | null;
  } = {},
): RegularizationCandidate {
  return {
    claim: { paymentId: "pay1", attempt: 1, ...change.claim },
    payment:
      change.payment === null
        ? null
        : {
            id: "pay1",
            bookingId: "book1",
            status: "REQUIRES_ACTION",
            attempt: 1,
            stripePaymentIntentId: "pi_1",
            ...change.payment,
          },
    booking:
      change.booking === null
        ? null
        : {
            id: "book1",
            status: "ACCEPTED",
            currentPaymentId: "pay1",
            pickupAt: new Date("2026-11-02T09:00:00Z"),
            ...change.booking,
          },
  };
}

describe("isRegularizationLinkUsable", () => {
  it("accepts the current REQUIRES_ACTION payment of an accepted future booking", () => {
    expect(isRegularizationLinkUsable(candidate(), NOW)).toBe(true);
  });

  it("refuses an unknown payment or booking", () => {
    expect(isRegularizationLinkUsable(candidate({ payment: null }), NOW)).toBe(false);
    expect(isRegularizationLinkUsable(candidate({ booking: null }), NOW)).toBe(false);
  });

  it("refuses a link of another attempt (a retry invalidates it)", () => {
    expect(isRegularizationLinkUsable(candidate({ payment: { attempt: 2 } }), NOW)).toBe(false);
    expect(isRegularizationLinkUsable(candidate({ claim: { attempt: 2 } }), NOW)).toBe(false);
  });

  it("refuses a payment that is not the booking's current one", () => {
    expect(
      isRegularizationLinkUsable(candidate({ booking: { currentPaymentId: "pay2" } }), NOW),
    ).toBe(false);
    expect(
      isRegularizationLinkUsable(candidate({ booking: { currentPaymentId: null } }), NOW),
    ).toBe(false);
    expect(isRegularizationLinkUsable(candidate({ payment: { bookingId: "book2" } }), NOW)).toBe(
      false,
    );
    expect(isRegularizationLinkUsable(candidate({ claim: { paymentId: "pay2" } }), NOW)).toBe(
      false,
    );
  });

  it.each(PAYMENT_STATUSES.filter((status) => status !== "REQUIRES_ACTION"))(
    "refuses a %s payment",
    (status) => {
      expect(isRegularizationLinkUsable(candidate({ payment: { status } }), NOW)).toBe(false);
    },
  );

  it("refuses a payment without PaymentIntent", () => {
    expect(
      isRegularizationLinkUsable(candidate({ payment: { stripePaymentIntentId: null } }), NOW),
    ).toBe(false);
  });

  it.each(BOOKING_STATUSES.filter((status) => status !== "ACCEPTED"))(
    "refuses a %s booking",
    (status) => {
      expect(isRegularizationLinkUsable(candidate({ booking: { status } }), NOW)).toBe(false);
    },
  );

  it("refuses once the pickup time is reached", () => {
    expect(isRegularizationLinkUsable(candidate({ booking: { pickupAt: NOW } }), NOW)).toBe(false);
    expect(
      isRegularizationLinkUsable(
        candidate({ booking: { pickupAt: new Date(NOW.getTime() - 1) } }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isRegularizationLinkUsable(
        candidate({ booking: { pickupAt: new Date(NOW.getTime() + 1) } }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("regularizationStep", () => {
  const intent = (
    status: string,
    errorCode: string | null = null,
    declineCode: string | null = null,
  ) => ({
    status,
    errorCode,
    declineCode,
  });

  it("confirms again an off-session PaymentIntent that asked for authentication", () => {
    expect(regularizationStep(intent("requires_payment_method", "authentication_required"))).toBe(
      "confirm",
    );
    expect(
      regularizationStep(
        intent("requires_payment_method", "card_declined", "authentication_required"),
      ),
    ).toBe("confirm");
    expect(regularizationStep(intent("requires_confirmation"))).toBe("confirm");
  });

  it("runs the pending authentication step of a requires_action PaymentIntent", () => {
    expect(regularizationStep(intent("requires_action"))).toBe("next_action");
  });

  it("reports a paid or processing PaymentIntent as settled", () => {
    expect(regularizationStep(intent("succeeded"))).toBe("settled");
    expect(regularizationStep(intent("processing"))).toBe("settled");
  });

  it("closes anything else: declined, failed authentication, canceled", () => {
    expect(
      regularizationStep(intent("requires_payment_method", "card_declined", "insufficient_funds")),
    ).toBe("closed");
    expect(
      regularizationStep(
        intent("requires_payment_method", "payment_intent_authentication_failure"),
      ),
    ).toBe("closed");
    expect(regularizationStep(intent("requires_payment_method"))).toBe("closed");
    expect(regularizationStep(intent("canceled"))).toBe("closed");
    expect(regularizationStep(intent("requires_capture"))).toBe("closed");
  });
});
