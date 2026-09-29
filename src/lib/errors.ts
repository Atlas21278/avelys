/**
 * Catalogue of public API error codes (docs/architecture/api.md). A response body is always
 * `{ error: { code, message, correlationId } }`: a stable code, a user-facing message in the
 * caller's language, and the correlation id found in the logs. Never a stack trace or an
 * internal detail.
 */

export type ApiLocale = "fr" | "en";

type CatalogEntry = Readonly<{ status: number; message: Readonly<Record<ApiLocale, string>> }>;

export const API_ERRORS = {
  INVALID_INPUT: {
    status: 400,
    message: {
      fr: "La demande est incomplète ou invalide.",
      en: "The request is incomplete or invalid.",
    },
  },
  BOOKING_LEAD_TIME_TOO_SHORT: {
    status: 422,
    message: {
      fr: "Cette prise en charge est trop proche pour une réservation en ligne. Contactez-nous directement.",
      en: "This pickup is too soon to be booked online. Please contact us directly.",
    },
  },
  LOCAL_TIME_NONEXISTENT: {
    status: 422,
    message: {
      fr: "Cette heure n'existe pas ce jour-là à Paris (passage à l'heure d'été). Choisissez une autre heure.",
      en: "This time does not exist on that day in Paris (clocks go forward). Please choose another time.",
    },
  },
  LOCAL_TIME_AMBIGUOUS: {
    status: 422,
    message: {
      fr: "Cette heure existe deux fois ce jour-là à Paris (passage à l'heure d'hiver). Choisissez une autre heure.",
      en: "This time occurs twice on that day in Paris (clocks go back). Please choose another time.",
    },
  },
  ROUTE_UNAVAILABLE: {
    status: 422,
    message: {
      fr: "Aucun itinéraire routier n'a pu être calculé : aucun prix ne peut être proposé.",
      en: "No road route could be computed, so no price can be offered.",
    },
  },
  NO_ACTIVE_PRICING_RULE: {
    status: 503,
    message: {
      fr: "Le calcul de prix est momentanément indisponible.",
      en: "Pricing is temporarily unavailable.",
    },
  },
  PRICING_UNAVAILABLE: {
    status: 503,
    message: {
      fr: "Le calcul de prix est momentanément indisponible.",
      en: "Pricing is temporarily unavailable.",
    },
  },
  PRICE_CHANGED: {
    status: 409,
    message: {
      fr: "Le prix de ce trajet a changé. Vérifiez le nouveau prix avant de confirmer votre demande.",
      en: "The price of this trip has changed. Please review the new price before confirming your request.",
    },
  },
  PAYMENT_METHOD_REQUIRED: {
    status: 422,
    message: {
      fr: "Un moyen de paiement confirmé est nécessaire pour envoyer votre demande. Aucun montant n'est débité à cette étape.",
      en: "A confirmed payment method is required to send your request. Nothing is charged at this stage.",
    },
  },
  PAYMENT_UNAVAILABLE: {
    status: 503,
    message: {
      fr: "L'enregistrement du moyen de paiement est momentanément indisponible. Aucun montant n'a été débité.",
      en: "Saving a payment method is temporarily unavailable. Nothing has been charged.",
    },
  },
  BOOKING_REFERENCE_UNAVAILABLE: {
    status: 503,
    message: {
      fr: "Votre demande n'a pas pu être enregistrée. Réessayez dans un instant.",
      en: "Your request could not be saved. Please try again in a moment.",
    },
  },
  DATABASE_UNAVAILABLE: {
    status: 503,
    message: {
      fr: "Service momentanément indisponible.",
      en: "Service temporarily unavailable.",
    },
  },
  // Stripe webhook endpoint (VTC-030). Read by Stripe, not by a person: French by default.
  INVALID_WEBHOOK_SIGNATURE: {
    status: 400,
    message: {
      fr: "Signature du webhook absente ou invalide.",
      en: "Missing or invalid webhook signature.",
    },
  },
  WEBHOOK_NOT_CONFIGURED: {
    status: 500,
    message: {
      fr: "La réception des webhooks n'est pas configurée.",
      en: "Webhook reception is not configured.",
    },
  },
  INTERNAL_ERROR: {
    status: 500,
    message: {
      fr: "Une erreur inattendue est survenue.",
      en: "An unexpected error occurred.",
    },
  },
} as const satisfies Record<string, CatalogEntry>;

export type ApiErrorCode = keyof typeof API_ERRORS;

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; correlationId: string };
};

/** First language of `Accept-Language` if it is English, French otherwise (default locale). */
export function apiLocale(acceptLanguage: string | null): ApiLocale {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "en" || first.startsWith("en-") ? "en" : "fr";
}

export function apiErrorBody(
  code: ApiErrorCode,
  correlationId: string,
  locale: ApiLocale,
): ApiErrorBody {
  return { error: { code, message: API_ERRORS[code].message[locale], correlationId } };
}

/**
 * JSON error response. `status` overrides the catalogue status when one code covers several
 * causes (e.g. `ROUTE_UNAVAILABLE`: 422 when no route exists, 503 when the provider is down).
 */
export function apiErrorResponse(
  code: ApiErrorCode,
  options: {
    correlationId: string;
    locale: ApiLocale;
    status?: number;
    headers?: Record<string, string>;
  },
): Response {
  return Response.json(apiErrorBody(code, options.correlationId, options.locale), {
    status: options.status ?? API_ERRORS[code].status,
    headers: options.headers,
  });
}
