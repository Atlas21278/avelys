import { expect, type Frame, type Page } from "@playwright/test";

import { formatCardNumber } from "../stubs/cards";
import type { StripeMode } from "./env";

/**
 * How a test types a card and answers the 3-D Secure window, in each Stripe mode (VTC-048).
 *
 * - `fake`: the fake Payment Element is a plain field of the page; the simulated 3-D Secure
 *   dialog offers « Complete » / « Fail ».
 * - `stripe-test`: the real Payment Element lives in Stripe's iframes, and the test mode
 *   authentication page in nested iframes. Frames are searched by content rather than by their
 *   (undocumented) nesting, so that a layout change at Stripe does not break the suite.
 */
export interface StripeDriver {
  fillCard(page: Page, number: string): Promise<void>;
  /** Answers the 3-D Secure window that Stripe.js opens. */
  authenticate(page: Page, outcome: "complete" | "fail"): Promise<void>;
}

const fakeDriver: StripeDriver = {
  async fillCard(page, number) {
    await page.locator('[data-fake-stripe="payment-element"] input').fill(formatCardNumber(number));
  },
  async authenticate(page, outcome) {
    const dialog = page.getByRole("dialog", { name: /3D Secure/ });
    await dialog
      .getByRole("button", { name: outcome === "complete" ? "Complete" : "Fail" })
      .click();
  },
};

/** The first frame (searched repeatedly) where `selector` exists. */
async function frameWith(page: Page, selector: string, timeout = 30_000): Promise<Frame> {
  const search = async (): Promise<Frame | null> => {
    for (const frame of page.frames()) {
      // A frame may detach while it is searched: it simply does not match.
      const count = await frame
        .locator(selector)
        .count()
        .catch(() => 0);
      if (count > 0) return frame;
    }
    return null;
  };
  let found: Frame | null = null;
  await expect
    .poll(async () => (found = await search()) !== null, {
      timeout,
      message: `no Stripe frame with ${selector}`,
    })
    .toBe(true);
  if (!found) throw new Error(`no Stripe frame with ${selector}`);
  return found;
}

const stripeTestModeDriver: StripeDriver = {
  async fillCard(page, number) {
    const frame = await frameWith(page, 'input[name="number"]');
    await frame.locator('input[name="number"]').fill(formatCardNumber(number));
    await frame.locator('input[name="expiry"]').fill("12 / 34");
    await frame.locator('input[name="cvc"]').fill("123");
    // Shown for some countries only (the default country follows the browser and the IP).
    const postalCode = frame.locator('input[name="postalCode"]');
    if (await postalCode.isVisible().catch(() => false)) await postalCode.fill("75009");
  },
  async authenticate(page, outcome) {
    // Stripe's test authentication page: « Complete » / « Fail » buttons.
    const selector =
      outcome === "complete"
        ? '#test-source-authorize-3ds, button:has-text("Complete")'
        : '#test-source-fail-3ds, button:has-text("Fail")';
    const frame = await frameWith(page, selector, 60_000);
    await frame.locator(selector).first().click();
  },
};

export function stripeDriver(mode: StripeMode): StripeDriver {
  return mode === "fake" ? fakeDriver : stripeTestModeDriver;
}
