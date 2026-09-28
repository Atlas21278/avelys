import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// Locale-aware wrappers around Next.js navigation: use these for every internal link.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
