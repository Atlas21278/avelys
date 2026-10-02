import { describe, expect, it } from "vitest";

import { money } from "@/lib/money";
import {
  displayedTotalOf,
  initialRequestStepState,
  isEmailLocked,
  requestStepReducer,
  type RequestStepAction,
  type RequestStepState,
} from "@/lib/request-step-state";

const reduce = (state: RequestStepState, ...actions: RequestStepAction[]) =>
  actions.reduce(requestStepReducer, state);

const quoted = reduce(initialRequestStepState("id-0"), {
  type: "quote",
  fingerprint: "fp-1",
  submissionId: "id-1",
});
const withEmail = reduce(quoted, {
  type: "field",
  field: "email",
  value: "guest@avelys.test",
  submissionId: "id-2",
});
const creating = reduce(withEmail, {
  type: "setupStarted",
  epoch: withEmail.epoch,
  email: "guest@avelys.test",
});
const entry = reduce(creating, {
  type: "setupCreated",
  epoch: creating.epoch,
  clientSecret: "seti_1_secret_x",
});
const submitting = reduce(entry, { type: "submitStarted", epoch: entry.epoch, acceptPrice: false });
const saved = reduce(submitting, {
  type: "cardSaved",
  epoch: submitting.epoch,
  paymentSetupId: "seti_1",
});

describe("submissionId (review notes of VTC-045)", () => {
  it("binds the step to the first quote with a fresh id", () => {
    expect(quoted).toMatchObject({ fingerprint: "fp-1", submissionId: "id-1" });
  });

  it("draws a new id when the email changes before the card step", () => {
    expect(withEmail.submissionId).toBe("id-2");
    expect(withEmail.contact.email).toBe("guest@avelys.test");
  });

  it("keeps the id when another field changes", () => {
    const named = reduce(withEmail, {
      type: "field",
      field: "name",
      value: "Guest",
      submissionId: "unused",
    });
    expect(named.submissionId).toBe("id-2");
  });

  it("locks the email once a SetupIntent exists for it", () => {
    expect(isEmailLocked(entry)).toBe(true);
    const typed = reduce(entry, {
      type: "field",
      field: "email",
      value: "other@avelys.test",
      submissionId: "id-x",
    });
    expect(typed).toBe(entry);
  });

  it("restarts the card step with a new id when the visitor changes a locked email", () => {
    const restarted = reduce(saved, {
      type: "submitFailed",
      epoch: saved.epoch,
      failure: "network",
      submissionId: "n",
    });
    const changed = reduce(restarted, { type: "changeEmail", submissionId: "id-3" });
    expect(changed.card).toEqual({ kind: "none" });
    expect(changed.submissionId).toBe("id-3");
    expect(changed.epoch).toBe(restarted.epoch + 1);
    expect(isEmailLocked(changed)).toBe(false);
  });

  it("does not let the email change while the request is being sent", () => {
    expect(reduce(submitting, { type: "changeEmail", submissionId: "id-3" })).toBe(submitting);
  });
});

describe("quote fingerprint", () => {
  it("keeps everything when the same quote comes back (same trip, same price)", () => {
    expect(reduce(saved, { type: "quote", fingerprint: "fp-1", submissionId: "id-9" })).toBe(saved);
  });

  it("drops the saved card and draws a new id when the quote changes after card setup", () => {
    const changed = reduce(saved, { type: "quote", fingerprint: "fp-2", submissionId: "id-9" });
    expect(changed).toMatchObject({
      fingerprint: "fp-2",
      submissionId: "id-9",
      card: { kind: "none" },
      pending: null,
      epoch: saved.epoch + 1,
    });
    // The contact details are kept.
    expect(changed.contact.email).toBe("guest@avelys.test");
  });

  it("ignores an answer that belongs to the previous quote", () => {
    const changed = reduce(submitting, {
      type: "quote",
      fingerprint: "fp-2",
      submissionId: "id-9",
    });
    const late = reduce(changed, {
      type: "submitted",
      epoch: submitting.epoch,
      reference: "VTC-OLD",
    });
    expect(late).toBe(changed);
    expect(late.reference).toBeNull();
  });

  it("drops a confirmed new price when the quote changes", () => {
    const priceChanged = reduce(saved, {
      type: "submitFailed",
      epoch: saved.epoch,
      failure: "priceChanged",
      total: money(5100),
      submissionId: "n",
    });
    const accepted = reduce(priceChanged, {
      type: "submitStarted",
      epoch: priceChanged.epoch,
      acceptPrice: true,
    });
    const changed = reduce(accepted, { type: "quote", fingerprint: "fp-2", submissionId: "id-9" });
    expect(changed.acceptedTotal).toBeNull();
    expect(changed.priceChange).toBeNull();
  });
});

describe("double submission", () => {
  it("ignores a second card setup while the first is in flight", () => {
    expect(
      reduce(creating, { type: "setupStarted", epoch: creating.epoch, email: "guest@avelys.test" }),
    ).toBe(creating);
  });

  it("ignores a second submission while the first is in flight", () => {
    expect(submitting.pending).toBe("submit");
    expect(
      reduce(submitting, { type: "submitStarted", epoch: submitting.epoch, acceptPrice: false }),
    ).toBe(submitting);
  });

  it("refuses to submit without a card", () => {
    expect(
      reduce(withEmail, { type: "submitStarted", epoch: withEmail.epoch, acceptPrice: false }),
    ).toBe(withEmail);
  });

  it("keeps the confirmed SetupIntent for a retry after a network error", () => {
    const failed = reduce(saved, {
      type: "submitFailed",
      epoch: saved.epoch,
      failure: "network",
      submissionId: "n",
    });
    expect(failed).toMatchObject({ pending: null, failure: "network" });
    expect(failed.card).toEqual({
      kind: "saved",
      email: "guest@avelys.test",
      paymentSetupId: "seti_1",
    });
    const retry = reduce(failed, {
      type: "submitStarted",
      epoch: failed.epoch,
      acceptPrice: false,
    });
    expect(retry.pending).toBe("submit");
    expect(retry.card).toBe(failed.card);
  });

  it("freezes the step once the reference is known", () => {
    const done = reduce(saved, {
      type: "submitted",
      epoch: saved.epoch,
      reference: "VTC-AB12CD34",
    });
    expect(done).toMatchObject({ reference: "VTC-AB12CD34", pending: null });
    expect(reduce(done, { type: "quote", fingerprint: "fp-2", submissionId: "z" })).toBe(done);
    expect(reduce(done, { type: "submitStarted", epoch: done.epoch, acceptPrice: false })).toBe(
      done,
    );
  });
});

describe("price change", () => {
  const priceChanged = reduce(saved, {
    type: "submitFailed",
    epoch: saved.epoch,
    failure: "priceChanged",
    total: money(5100),
    submissionId: "n",
  });

  it("shows the new server price and sends nothing without explicit confirmation", () => {
    expect(priceChanged).toMatchObject({ failure: "priceChanged", priceChange: money(5100) });
    expect(
      reduce(priceChanged, {
        type: "submitStarted",
        epoch: priceChanged.epoch,
        acceptPrice: false,
      }),
    ).toBe(priceChanged);
  });

  it("sends the confirmed price as the displayed total, with the same SetupIntent", () => {
    const accepted = reduce(priceChanged, {
      type: "submitStarted",
      epoch: priceChanged.epoch,
      acceptPrice: true,
    });
    expect(accepted).toMatchObject({
      pending: "submit",
      priceChange: null,
      acceptedTotal: money(5100),
    });
    expect(accepted.card).toEqual(saved.card);
    expect(displayedTotalOf(accepted, money(4852))).toEqual(money(5100));
    expect(displayedTotalOf(saved, money(4852))).toEqual(money(4852));
  });
});

describe("card and payment failures", () => {
  it("shows Stripe's localised message and keeps the Payment Element on a card refusal", () => {
    const refused = reduce(submitting, {
      type: "cardFailed",
      epoch: submitting.epoch,
      message: "Your card was declined.",
    });
    expect(refused).toMatchObject({
      pending: null,
      cardMessage: "Your card was declined.",
      failure: null,
      card: { kind: "entry" },
    });
  });

  it("uses a generic message for any other Stripe.js error", () => {
    const failed = reduce(submitting, {
      type: "cardFailed",
      epoch: submitting.epoch,
      message: null,
    });
    expect(failed).toMatchObject({ failure: "cardUnexpected", cardMessage: null });
  });

  it("restarts the card step with a new id on PAYMENT_METHOD_REQUIRED", () => {
    const refused = reduce(saved, {
      type: "submitFailed",
      epoch: saved.epoch,
      failure: "paymentRequired",
      submissionId: "id-5",
    });
    expect(refused).toMatchObject({
      failure: "paymentRequired",
      card: { kind: "none" },
      submissionId: "id-5",
      pending: null,
    });
  });

  it("draws a new id after a payment setup conflict, keeps it after other failures", () => {
    const conflict = reduce(creating, {
      type: "setupFailed",
      epoch: creating.epoch,
      failure: "setupConflict",
      submissionId: "id-6",
    });
    expect(conflict).toMatchObject({ card: { kind: "none" }, submissionId: "id-6" });
    const network = reduce(creating, {
      type: "setupFailed",
      epoch: creating.epoch,
      failure: "network",
      submissionId: "id-7",
    });
    expect(network.submissionId).toBe(creating.submissionId);
  });
});

describe("contact issues", () => {
  it("clears the issue of the field being fixed", () => {
    const invalid = reduce(quoted, {
      type: "invalid",
      issues: ["name", "transportScheduled", "terms"],
    });
    const fixed = reduce(
      invalid,
      { type: "field", field: "name", value: "Guest", submissionId: "x" },
      { type: "field", field: "transportTime", value: "14:10", submissionId: "x" },
      { type: "terms", accepted: true },
    );
    expect(fixed.issues).toEqual([]);
  });
});
