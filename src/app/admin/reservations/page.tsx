import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { textLinkClasses } from "@/components/ui/text-link";
import { formatParisDate, formatParisDateTimeUnambiguous, parisDayStart } from "@/lib/dates";
import {
  bookingListSearch,
  hasInvertedDateRange,
  parseBookingListQuery,
} from "@/server/admin/booking-list-query";
import { type BookingListItem, listBackOfficeBookings } from "@/server/admin/bookings";
import { requireBackOfficeUser } from "@/server/auth/back-office";

import { AdminNav } from "../_components/admin-nav";
import { BookingFilters } from "./_components/booking-filters";
import { formatAmount, formatCount } from "./_components/format";
import { StatusBadge } from "./_components/status-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Réservations — Back-office Avelys" };

export default async function BookingsPage({ searchParams }: PageProps<"/admin/reservations">) {
  await requireBackOfficeUser();

  const query = parseBookingListQuery(await searchParams);
  const result = await listBackOfficeBookings(await headers(), query);
  const requested = result.items.filter((item) => item.status === "REQUESTED");
  const others = result.items.filter((item) => item.status !== "REQUESTED");

  return (
    <>
      <AdminNav current="bookings" />
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-display-optical text-display-sm">Réservations</h1>
          <p className="text-graphite">
            {formatCount(result.total, "réservation", "réservations")} · heures de Paris
          </p>
        </header>

        <BookingFilters query={query} />

        {hasInvertedDateRange(query) && query.from && query.to ? (
          <p role="alert" className="text-ink">
            La date de début ({formatCalendarDate(query.from)}) est postérieure à la date de fin (
            {formatCalendarDate(query.to)}) : aucune réservation ne peut correspondre.{" "}
            <Link
              href={`/admin/reservations${bookingListSearch({ ...query, from: query.to, to: query.from, page: 1 })}`}
              className={textLinkClasses}
            >
              Inverser les dates
            </Link>
          </p>
        ) : result.items.length === 0 ? (
          <p className="py-10 text-graphite">
            {result.total === 0
              ? "Aucune réservation ne correspond à ces critères."
              : "Cette page est vide."}{" "}
            {query.page > 1 || result.total === 0 ? (
              <Link
                href={`/admin/reservations${bookingListSearch({ ...query, page: 1 })}`}
                className={textLinkClasses}
              >
                Revenir à la première page
              </Link>
            ) : null}
          </p>
        ) : (
          <>
            {requested.length > 0 ? (
              <BookingGroup title="Demandes à traiter" items={requested} />
            ) : null}
            {others.length > 0 ? <BookingGroup title="Autres réservations" items={others} /> : null}
          </>
        )}

        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) => `/admin/reservations${bookingListSearch({ ...query, page })}`}
        />
      </div>
    </>
  );
}

/** `dim. 25 oct. 2026` for a Paris calendar day `YYYY-MM-DD`. */
function formatCalendarDate(calendarDate: string): string {
  return formatParisDate(parisDayStart(calendarDate));
}

function BookingGroup({ title, items }: { title: string; items: readonly BookingListItem[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="small-caps-label text-graphite">{title}</h2>
      <ul className="border-t border-hairline">
        {items.map((item) => (
          <li key={item.reference} className="border-b border-hairline">
            <BookingRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BookingRow({ item }: { item: BookingListItem }) {
  return (
    <Link
      href={`/admin/reservations/${item.reference}`}
      className="-mx-2 flex flex-col gap-1.5 px-2 py-4 transition-colors duration-200 ease-settle hover:bg-paper-deep sm:grid sm:grid-cols-[11rem_1fr_auto] sm:items-baseline sm:gap-x-6"
    >
      <span className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-1.5">
        <span className="font-semibold tracking-wide">{item.reference}</span>
        <StatusBadge status={item.status} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <time dateTime={item.pickupAt.toISOString()} className="font-semibold">
          {formatParisDateTimeUnambiguous(item.pickupAt)}
        </time>
        <span className="text-ink">
          {item.pickupLabel} <span aria-label="vers">→</span> {item.dropoffLabel}
        </span>
        <span className="text-sm text-graphite">
          {item.contactName} · {formatCount(item.passengerCount, "passager", "passagers")} ·{" "}
          {formatCount(item.luggageCount, "bagage", "bagages")}
        </span>
      </span>
      <data
        value={item.totalTtcCents}
        className="font-display-figure text-lg sm:text-right"
        title="Montant TTC"
      >
        {formatAmount(item.totalTtcCents, item.currency)}
        <span className="sr-only"> TTC</span>
      </data>
    </Link>
  );
}

function Pagination({
  page,
  pageCount,
  href,
}: {
  page: number;
  pageCount: number;
  href: (page: number) => string;
}) {
  if (pageCount <= 1 && page <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-2">
      {page > 1 ? (
        <Link href={href(Math.min(page - 1, pageCount))} className={textLinkClasses} rel="prev">
          ← Précédente
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-graphite">
        Page {page} sur {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={textLinkClasses} rel="next">
          Suivante →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
