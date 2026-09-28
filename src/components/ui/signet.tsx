import { cx } from "@/lib/cx";

/**
 * The champagne ribbon bookmark: marks the reader's current place (active nav item,
 * selected option, the itinerary card). Decorative only — the state it marks must also
 * be conveyed by text or ARIA.
 */
export function Signet({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 32"
      className={cx("h-8 w-3.5 text-champagne", className)}
      fill="currentColor"
    >
      <path d="M0 0h14v32l-7-6.5L0 32z" />
    </svg>
  );
}
