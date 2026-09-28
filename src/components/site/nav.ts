import type { AppPathname } from "@/i18n/routing";

/** Main navigation (Master Spec §4.1), shared by the header, the mobile menu and the footer. */
export const SITE_NAV = [
  { href: "/services", key: "services" },
  { href: "/entreprises", key: "business" },
  { href: "/flotte", key: "fleet" },
  { href: "/a-propos", key: "about" },
  { href: "/contact", key: "contact" },
] as const satisfies readonly { href: AppPathname; key: string }[];

/** Legal pages listed in the footer (Master Spec §5); their content is provisional (VTC-018). */
export const LEGAL_NAV = [
  { href: "/mentions-legales", key: "legalNotice" },
  { href: "/confidentialite", key: "privacy" },
  { href: "/cookies", key: "cookies" },
  { href: "/cgv", key: "terms" },
] as const satisfies readonly { href: AppPathname; key: string }[];
