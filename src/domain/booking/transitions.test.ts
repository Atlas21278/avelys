import { describe, expect, it } from "vitest";

import { ROLES } from "../auth/access";
import { DomainError } from "../errors";
import { BOOKING_STATUSES, FINAL_BOOKING_STATUSES, isBookingStatus } from "./status";
import type { BookingStatus } from "./status";
import {
  allowedTransitions,
  assertCanCreateBooking,
  assertTransition,
  BOOKING_ACTORS,
  BOOKING_CREATION_ACTORS,
  BOOKING_TRANSITIONS,
  canCreateBooking,
  canTransition,
  InvalidBookingTransitionError,
  isFinal,
} from "./transitions";
import type { BookingActor } from "./transitions";

/**
 * Expected table, written by hand from the "Transitions autorisées" table of
 * docs/product/booking.md — deliberately NOT derived from the code under test.
 * Key: `${from}>${to}`, value: the actors allowed (literal reading, VTC-019).
 */
const EXPECTED: Readonly<Record<string, readonly BookingActor[]>> = {
  "REQUESTED>ACCEPTED": ["ADMIN", "DISPATCHER"],
  "REQUESTED>REFUSED": ["ADMIN", "DISPATCHER"],
  "REQUESTED>CANCELLED": ["CUSTOMER"],
  "ACCEPTED>CONFIRMED": ["SYSTEM"],
  "ACCEPTED>CANCELLED": ["SYSTEM", "CUSTOMER", "ADMIN"],
  "CONFIRMED>DRIVER_ASSIGNED": ["ADMIN", "DISPATCHER"],
  "CONFIRMED>CANCELLED": ["CUSTOMER", "ADMIN"],
  "DRIVER_ASSIGNED>CANCELLED": ["CUSTOMER", "ADMIN"],
  "DRIVER_ASSIGNED>CONFIRMED": ["ADMIN", "DISPATCHER"],
  "DRIVER_ASSIGNED>IN_PROGRESS": ["DRIVER"],
  "DRIVER_ASSIGNED>NO_SHOW": ["DRIVER", "ADMIN"],
  "IN_PROGRESS>COMPLETED": ["DRIVER"],
};

const ALL_STATUSES = [
  "REQUESTED",
  "ACCEPTED",
  "REFUSED",
  "CANCELLED",
  "CONFIRMED",
  "DRIVER_ASSIGNED",
  "IN_PROGRESS",
  "NO_SHOW",
  "COMPLETED",
] as const satisfies readonly BookingStatus[];

const ALL_ACTORS = [
  "CUSTOMER",
  "ADMIN",
  "DISPATCHER",
  "DRIVER",
  "SYSTEM",
] as const satisfies readonly BookingActor[];

function expectedAllowed(from: BookingStatus, to: BookingStatus, actor: BookingActor): boolean {
  return EXPECTED[`${from}>${to}`]?.includes(actor) ?? false;
}

function catchError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("booking statuses", () => {
  it("lists exactly the nine statuses of booking.md", () => {
    expect([...BOOKING_STATUSES].sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("marks REFUSED, CANCELLED, NO_SHOW and COMPLETED as final, and only them", () => {
    expect([...FINAL_BOOKING_STATUSES].sort()).toEqual(
      ["CANCELLED", "COMPLETED", "NO_SHOW", "REFUSED"].sort(),
    );
    for (const status of ALL_STATUSES) {
      expect(isFinal(status)).toBe(FINAL_BOOKING_STATUSES.includes(status as never));
    }
  });

  it("keeps payment statuses out of the booking statuses (BR-41)", () => {
    for (const paymentStatus of ["PAID", "PENDING", "FAILED", "REFUNDED", "AUTHORIZED"]) {
      expect(isBookingStatus(paymentStatus)).toBe(false);
    }
  });

  it("does not store ON_TRIP (computed, CLAUDE.md rule 8)", () => {
    expect(isBookingStatus("ON_TRIP")).toBe(false);
  });

  it("recognises only exact status strings", () => {
    for (const status of ALL_STATUSES) expect(isBookingStatus(status)).toBe(true);
    for (const value of ["requested", "", null, undefined, 1]) {
      expect(isBookingStatus(value)).toBe(false);
    }
  });
});

describe("booking actors", () => {
  it("are the four RBAC roles plus SYSTEM", () => {
    expect([...BOOKING_ACTORS].sort()).toEqual([...ALL_ACTORS].sort());
    expect([...BOOKING_ACTORS].sort()).toEqual([...ROLES, "SYSTEM"].sort());
  });
});

describe("transition table", () => {
  it("has exactly the rows of booking.md, one per (from, to) pair", () => {
    const actual = Object.fromEntries(
      BOOKING_TRANSITIONS.map((row) => [`${row.from}>${row.to}`, [...row.actors].sort()]),
    );
    const expected = Object.fromEntries(
      Object.entries(EXPECTED).map(([key, actors]) => [key, [...actors].sort()]),
    );
    expect(actual).toEqual(expected);
    expect(BOOKING_TRANSITIONS).toHaveLength(Object.keys(EXPECTED).length);
  });

  it("is frozen, rows and actor lists included", () => {
    expect(Object.isFrozen(BOOKING_TRANSITIONS)).toBe(true);
    for (const row of BOOKING_TRANSITIONS) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.actors)).toBe(true);
    }
  });

  it("never leaves a final status", () => {
    for (const row of BOOKING_TRANSITIONS) expect(isFinal(row.from)).toBe(false);
  });
});

describe("canTransition / assertTransition — cartesian product 9 x 9 x 5", () => {
  const cases = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.flatMap((to) =>
      ALL_ACTORS.map((actor) => ({ from, to, actor, allowed: expectedAllowed(from, to, actor) })),
    ),
  );

  it("covers 405 combinations, 21 of them allowed", () => {
    expect(cases).toHaveLength(405);
    expect(cases.filter((c) => c.allowed)).toHaveLength(21);
  });

  it.each(cases)("$from -> $to by $actor: allowed=$allowed", ({ from, to, actor, allowed }) => {
    expect(canTransition(from, to, actor)).toBe(allowed);
    if (allowed) {
      expect(() => assertTransition(from, to, actor)).not.toThrow();
    } else {
      const error = catchError(() => assertTransition(from, to, actor));
      expect(error).toBeInstanceOf(InvalidBookingTransitionError);
      expect(error).toMatchObject({ code: "INVALID_BOOKING_TRANSITION", from, to, actor });
    }
  });
});

describe("allowedTransitions", () => {
  it.each(ALL_STATUSES.flatMap((from) => ALL_ACTORS.map((actor) => ({ from, actor }))))(
    "lists the targets reachable from $from by $actor",
    ({ from, actor }) => {
      const expected = ALL_STATUSES.filter((to) => expectedAllowed(from, to, actor));
      expect([...allowedTransitions(from, actor)].sort()).toEqual([...expected].sort());
    },
  );

  it("returns nothing from a final status, whatever the actor", () => {
    for (const status of FINAL_BOOKING_STATUSES) {
      for (const actor of ALL_ACTORS) expect(allowedTransitions(status, actor)).toEqual([]);
    }
  });
});

describe("named cases (VTC-019)", () => {
  it("allows unassignment DRIVER_ASSIGNED -> CONFIRMED by ADMIN and DISPATCHER", () => {
    expect(canTransition("DRIVER_ASSIGNED", "CONFIRMED", "ADMIN")).toBe(true);
    expect(canTransition("DRIVER_ASSIGNED", "CONFIRMED", "DISPATCHER")).toBe(true);
    expect(canTransition("DRIVER_ASSIGNED", "CONFIRMED", "DRIVER")).toBe(false);
  });

  it("allows ACCEPTED -> CANCELLED by SYSTEM (payment not settled in time, DEC-13)", () => {
    expect(() => assertTransition("ACCEPTED", "CANCELLED", "SYSTEM")).not.toThrow();
  });

  it("refuses IN_PROGRESS -> CANCELLED for every actor", () => {
    for (const actor of ALL_ACTORS) {
      expect(() => assertTransition("IN_PROGRESS", "CANCELLED", actor)).toThrow(
        InvalidBookingTransitionError,
      );
    }
  });

  it("refuses any transition out of COMPLETED", () => {
    for (const to of ALL_STATUSES) {
      for (const actor of ALL_ACTORS) expect(canTransition("COMPLETED", to, actor)).toBe(false);
    }
  });

  it("refuses X -> X for every status and actor", () => {
    for (const status of ALL_STATUSES) {
      for (const actor of ALL_ACTORS) expect(canTransition(status, status, actor)).toBe(false);
    }
  });

  it("does not let a CUSTOMER accept or refuse a booking", () => {
    expect(canTransition("REQUESTED", "ACCEPTED", "CUSTOMER")).toBe(false);
    expect(canTransition("REQUESTED", "REFUSED", "CUSTOMER")).toBe(false);
  });

  it("does not let a CUSTOMER confirm a booking: only the payment path (SYSTEM) does", () => {
    for (const actor of ["CUSTOMER", "ADMIN", "DISPATCHER", "DRIVER"] as const) {
      expect(canTransition("ACCEPTED", "CONFIRMED", actor)).toBe(false);
    }
  });
});

describe("creation", () => {
  it("is reserved to CUSTOMER", () => {
    expect(BOOKING_CREATION_ACTORS).toEqual(["CUSTOMER"]);
    for (const actor of ALL_ACTORS) expect(canCreateBooking(actor)).toBe(actor === "CUSTOMER");
  });

  it("assertCanCreateBooking throws a typed error with from = null for other actors", () => {
    expect(() => assertCanCreateBooking("CUSTOMER")).not.toThrow();
    for (const actor of ["ADMIN", "DISPATCHER", "DRIVER", "SYSTEM"] as const) {
      const error = catchError(() => assertCanCreateBooking(actor));
      expect(error).toBeInstanceOf(InvalidBookingTransitionError);
      expect(error).toMatchObject({
        code: "INVALID_BOOKING_TRANSITION",
        from: null,
        to: "REQUESTED",
        actor,
      });
    }
  });
});

describe("InvalidBookingTransitionError", () => {
  it("is a DomainError carrying only statuses and actor, no personal data", () => {
    const error = catchError(() => assertTransition("COMPLETED", "CANCELLED", "CUSTOMER"));
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    const typed = error as InvalidBookingTransitionError;
    expect(typed.name).toBe("InvalidBookingTransitionError");
    expect(typed.message).toBe("Invalid booking transition: COMPLETED -> CANCELLED by CUSTOMER");
    expect(Object.keys(typed).sort()).toEqual(["actor", "code", "from", "name", "to"].sort());
  });

  it("formats creation errors without an origin status", () => {
    const error = catchError(() => assertCanCreateBooking("DRIVER")) as Error;
    expect(error.message).toBe("Invalid booking transition: (none) -> REQUESTED by DRIVER");
  });
});
