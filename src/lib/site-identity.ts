/**
 * Legal identity and direct contact channels shown in the site footer.
 *
 * PROVISOIRE — DEC-08 / DEC-20: none of these values is decided yet. Each stays `null` until the
 * owners confirm it, and the footer then shows a visible provisional placeholder. Never fill a
 * field with an invented or example value.
 */
export const SITE_IDENTITY_DECISIONS = "DEC-08 / DEC-20";

export const SITE_IDENTITY_FIELDS = [
  "companyName",
  "address",
  "siren",
  "vtcRegistration",
  "insurance",
  "phone",
  "email",
] as const;

export type SiteIdentityField = (typeof SITE_IDENTITY_FIELDS)[number];

export const siteIdentity: Record<SiteIdentityField, string | null> = {
  companyName: null,
  address: null,
  siren: null,
  vtcRegistration: null,
  insurance: null,
  phone: null,
  email: null,
};
