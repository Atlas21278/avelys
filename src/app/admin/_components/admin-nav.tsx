import Link from "next/link";

import { cx } from "@/lib/cx";

const LINKS = [
  { href: "/admin", label: "Accueil", section: "home" },
  { href: "/admin/reservations", label: "Réservations", section: "bookings" },
] as const;

export type AdminSection = (typeof LINKS)[number]["section"];

/** Navigation of the signed-in back-office. Rendered by each page, after its access guard. */
export function AdminNav({ current }: { current: AdminSection }) {
  return (
    <nav
      aria-label="Back-office"
      className="mb-8 flex items-baseline justify-between gap-4 border-b border-hairline pb-3"
    >
      <span className="small-caps-label whitespace-nowrap text-graphite">Back-office</span>
      <ul className="flex gap-5">
        {LINKS.map((link) => {
          const active = link.section === current;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center text-[0.9375rem] underline-offset-[6px]",
                  active
                    ? "font-semibold text-ink underline decoration-ink decoration-2"
                    : "text-graphite hover:text-ink hover:underline hover:decoration-rule",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
