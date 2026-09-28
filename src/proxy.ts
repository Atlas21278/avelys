import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

// Resolves the locale from the URL: `/…` is French (rewritten to `/fr/…` internally),
// `/en/…` is English with translated slugs, and `/fr/…` redirects to its unprefixed form.
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next.js internals, the internal design sheet, the future
  // back-office (French only, outside the public site) and files with an extension.
  matcher: "/((?!(?:api|_next|_vercel|design|admin)(?:/|$)|.*\\..*).*)",
};
