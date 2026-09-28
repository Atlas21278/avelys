import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { textLinkClasses } from "@/components/ui/text-link";
import { BOOKING_STATUSES } from "@/domain/booking/status";
import type { BookingListQuery } from "@/server/admin/booking-list-query";

import { STATUS_LABELS } from "./format";

/**
 * Server-side filters as a plain GET form: works without JavaScript, the URL is the state and
 * the server validates it again (booking-list-query.ts). Submitting resets to page 1.
 */
export function BookingFilters({ query }: { query: BookingListQuery }) {
  const active = query.statuses.length > 0 || Boolean(query.from) || Boolean(query.to);

  return (
    <details open={active} className="group border-y border-hairline">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 small-caps-label text-ink">
        <span>Filtres{active ? " actifs" : ""}</span>
        <span aria-hidden="true" className="text-graphite group-open:rotate-180">
          ▾
        </span>
      </summary>
      <form method="get" action="/admin/reservations" className="flex flex-col gap-6 pt-2 pb-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 small-caps-label text-graphite">Statut</legend>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 min-[380px]:grid-cols-2 sm:grid-cols-3">
            {BOOKING_STATUSES.map((status) => (
              <label key={status} className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name="status"
                  value={status}
                  defaultChecked={query.statuses.includes(status)}
                  className="size-5 shrink-0"
                />
                {STATUS_LABELS[status]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 small-caps-label text-graphite">
            Prise en charge (heure de Paris)
          </legend>
          <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 sm:max-w-md">
            <Field label="Du">
              <Input type="date" name="from" defaultValue={query.from ?? ""} />
            </Field>
            <Field label="Au">
              <Input type="date" name="to" defaultValue={query.to ?? ""} />
            </Field>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-6">
          <button type="submit" className={buttonClasses("primary")}>
            Filtrer
          </button>
          {active ? (
            <Link href="/admin/reservations" className={textLinkClasses}>
              Effacer les filtres
            </Link>
          ) : null}
        </div>
      </form>
    </details>
  );
}
