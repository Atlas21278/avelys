import { cx } from "@/lib/cx";

export type RouteLeg = {
  /** Pre-formatted for the locale by the caller, e.g. "32,4 km". */
  distance: string;
  /** Pre-formatted for the locale by the caller, e.g. "45 min". */
  duration: string;
};

export type RouteStop = {
  /** Place name, set in the display face. */
  label: string;
  /** Secondary line: terminal, address detail, time. */
  detail?: string;
  /** The road leg from this stop to the next one. Ignored on the last stop. */
  legToNext?: RouteLeg;
};

type RouteLineProps = {
  stops: readonly RouteStop[];
  /**
   * A committed route draws solid; a merely possible one stays dotted.
   * Switching to committed draws the line once (skipped under reduced motion).
   */
  committed?: boolean;
  /** Accessible name of the list, e.g. "Itinéraire". */
  label: string;
  /** Screen-reader prefix for a leg, e.g. "Trajet jusqu'à l'étape suivante". */
  legLabel?: string;
  className?: string;
};

export function RouteLine({
  stops,
  committed = false,
  label,
  legLabel,
  className,
}: RouteLineProps) {
  return (
    <ol aria-label={label} className={cx("relative flex flex-col", className)}>
      {stops.map((stop, index) => {
        const isLast = index === stops.length - 1;
        const leg = isLast ? undefined : stop.legToNext;
        return (
          <li key={`${index}-${stop.label}`} className="relative flex gap-4 pb-6 last:pb-0">
            <span className="relative flex w-7 shrink-0 justify-center">
              <span
                aria-hidden="true"
                className={cx(
                  "z-10 flex size-7 items-center justify-center rounded-full border text-[0.8125rem] font-semibold tabular-nums",
                  isLast ? "border-ink bg-ink text-paper" : "border-ink bg-paper text-ink",
                )}
              >
                {index + 1}
              </span>
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className="absolute top-7 bottom-[-0.25rem] left-[13px] w-px"
                >
                  <span
                    className={cx(
                      "absolute inset-0 border-l border-dotted border-rule transition-opacity duration-700",
                      committed && "opacity-0",
                    )}
                  />
                  <span
                    className={cx(
                      "absolute inset-0 origin-top bg-ink transition-transform duration-700 ease-settle",
                      committed ? "scale-y-100" : "scale-y-0",
                    )}
                    style={{ transitionDelay: `${index * 120}ms` }}
                  />
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <span className="font-display-figure text-xl leading-tight">{stop.label}</span>
              {stop.detail ? <span className="text-sm text-graphite">{stop.detail}</span> : null}
              {leg ? (
                // Guide-book dot leader: distance on the left, duration on the right.
                <span className="mt-2 flex items-baseline gap-2 text-sm">
                  {legLabel ? <span className="sr-only">{legLabel} :</span> : null}
                  <span>{leg.distance}</span>
                  <span
                    aria-hidden="true"
                    className="flex-1 translate-y-[-0.2em] border-b border-dotted border-rule"
                  />
                  <span>{leg.duration}</span>
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
