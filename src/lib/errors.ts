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
  DATABASE_UNAVAILABLE: {
    status: 503,
    message: {
      fr: "Service momentanément indisponible.",
      en: "Service temporarily unavailable.",
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
