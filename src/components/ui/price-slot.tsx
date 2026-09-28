import { formatMoney, type DisplayLocale, type Money } from "@/lib/money";
import { cx } from "@/lib/cx";

type PriceSlotProps = {
  /** Server-computed price; null while no quote exists. Never computed in the browser. */
  price: Money | null;
  locale: DisplayLocale;
  /** Caption above the figure, e.g. "Prix fixe, TTC". */
  label: string;
  /** Announced and shown faintly while the slot is empty, e.g. "Prix calculé après l'itinéraire". */
  emptyLabel: string;
  className?: string;
};

/**
 * The price owns a fixed, drawn place on the page from the first view: the slot never
 * moves or resizes, only the figure appears.
 */
export function PriceSlot({ price, locale, label, emptyLabel, className }: PriceSlotProps) {
  return (
    <div
      className={cx(
        "flex min-h-[6.5rem] flex-col justify-between gap-2 border px-4 py-3",
        price ? "border-ink" : "border-dashed border-rule",
        className,
      )}
    >
      <span className="small-caps-label text-graphite">{label}</span>
      <output aria-live="polite" className="flex min-h-10 items-end justify-between gap-3">
        {price ? (
          <span className="font-display-figure text-4xl leading-none">
            {formatMoney(price, locale)}
          </span>
        ) : (
          <>
            {/* The empty place is drawn, not typed: a fixed 1px rule where the figure will sit. */}
            <span aria-hidden="true" className="mb-2 block h-px w-16 shrink-0 bg-graphite" />
            <span className="text-right text-sm text-graphite">{emptyLabel}</span>
          </>
        )}
      </output>
    </div>
  );
}
