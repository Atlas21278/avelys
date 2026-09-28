import Stripe from "stripe";
import * as z from "zod";

/**
 * Stripe webhook verification (VTC-030, BR-42): the signature is checked on the raw body with the
 * endpoint signing secret, then the event envelope is validated with Zod. No Stripe API call and
 * no secret key are involved. Errors carry a code only: never the payload, the header or the
 * secret (the SDK error, which holds the payload, is not attached as a cause).
 */

export type StripeWebhookErrorCode =
  "WEBHOOK_NOT_CONFIGURED" | "INVALID_WEBHOOK_SIGNATURE" | "INVALID_WEBHOOK_PAYLOAD";

export class StripeWebhookError extends Error {
  constructor(readonly code: StripeWebhookErrorCode) {
    super(code);
    this.name = "StripeWebhookError";
  }
}

/** Fields the application relies on; the rest of the event is kept as sent by Stripe. */
const eventEnvelopeSchema = z.looseObject({
  id: z
    .string()
    .max(255)
    .regex(/^evt_[A-Za-z0-9]+$/),
  object: z.literal("event"),
  type: z.string().min(1).max(255),
  // Test mode only (BR-44): test and live signing secrets are indistinguishable, so a live event
  // is refused here until the live-activation ticket (CRITICAL).
  livemode: z.literal(false),
  created: z.number().int(),
  data: z.looseObject({ object: z.looseObject({}) }),
});

export type StripeWebhookEvent = Stripe.Event;

export interface StripeWebhookVerifier {
  /** Verified and validated event, or a `StripeWebhookError`. */
  verifyWebhookEvent(rawBody: string, signature: string | null): StripeWebhookEvent;
}

export function createStripeWebhookVerifier(options: {
  /** Endpoint signing secret, resolved on each call (never at import or build time). */
  secret: () => string | undefined;
}): StripeWebhookVerifier {
  return {
    verifyWebhookEvent(rawBody, signature) {
      const secret = options.secret();
      if (!secret) throw new StripeWebhookError("WEBHOOK_NOT_CONFIGURED");
      if (!signature) throw new StripeWebhookError("INVALID_WEBHOOK_SIGNATURE");

      let event: Stripe.Event;
      try {
        // Default tolerance (5 minutes) against replays of an old signed body.
        event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
      } catch (error) {
        throw new StripeWebhookError(
          error instanceof Stripe.errors.StripeSignatureVerificationError
            ? "INVALID_WEBHOOK_SIGNATURE"
            : "INVALID_WEBHOOK_PAYLOAD",
        );
      }

      if (!eventEnvelopeSchema.safeParse(event).success) {
        throw new StripeWebhookError("INVALID_WEBHOOK_PAYLOAD");
      }
      return event;
    },
  };
}
