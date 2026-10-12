/**
 * Stripe test cards of the end-to-end suite (VTC-048). Numbers from Stripe's testing page
 * (docs.stripe.com/testing, "Authentication and setup"): the same numbers drive the real Stripe
 * test mode project and the local fake, which reproduces their documented behaviour.
 */

export type TestCard = Readonly<{
  number: string;
  /** Strong customer authentication asked when the card is saved (SetupIntent, on session). */
  setupAuthentication: boolean;
  /** The later off-session charge (acceptance) is refused with `authentication_required`. */
  offSessionAuthenticationRequired: boolean;
  /** Authentication asked again when the customer confirms the payment on session. */
  onSessionAuthentication: boolean;
}>;

export const TEST_CARDS = {
  /** Succeeds, never asks for authentication. */
  success: {
    number: "4242424242424242",
    setupAuthentication: false,
    offSessionAuthenticationRequired: false,
    onSessionAuthentication: false,
  },
  /** Authentication when saved; once set up, off-session payments succeed without it. */
  authenticateOnSetup: {
    number: "4000002500003155",
    setupAuthentication: true,
    offSessionAuthenticationRequired: false,
    onSessionAuthentication: true,
  },
  /** Authentication required on every transaction, off-session charges included. */
  alwaysAuthenticate: {
    number: "4000002760003184",
    setupAuthentication: true,
    offSessionAuthenticationRequired: true,
    onSessionAuthentication: true,
  },
} as const satisfies Record<string, TestCard>;

export function testCardByNumber(number: string): TestCard | null {
  const digits = number.replace(/\D/g, "");
  return Object.values(TEST_CARDS).find((card) => card.number === digits) ?? null;
}

/** Card number as typed by a person, in groups of four. */
export function formatCardNumber(number: string): string {
  return number.replace(/(\d{4})(?=\d)/g, "$1 ");
}
