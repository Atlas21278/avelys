import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { RouteLine } from "@/components/ui/route-line";
import { textLinkClasses } from "@/components/ui/text-link";
import { formatParisDateTime, formatParisOffset } from "@/lib/dates";
import { type BookingAuditEntry, getBackOfficeBooking } from "@/server/admin/bookings";
import { requireBackOfficeUser } from "@/server/auth/back-office";

import { AdminNav } from "../../_components/admin-nav";
import {
  ACTOR_LABELS,
  formatAmount,
  formatDistance,
  formatDuration,
  LOCALE_LABELS,
  MISSING,
  STATUS_LABELS,
  TRANSPORT_LABELS,
} from "../_components/format";
import { StatusBadge } from "../_components/status-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Réservation — Back-office Avelys" };

export default async function BookingDetailPage({
  params,
}: PageProps<"/admin/reservations/[reference]">) {
  await requireBackOfficeUser();

  const { reference } = await params;
  const booking = await getBackOfficeBooking(await headers(), reference);
  if (!booking) notFound();

  const pickup = booking.pickupAt;

  return (
    <>
      <AdminNav current="bookings" />
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Link href="/admin/reservations" className={`${textLinkClasses} self-start text-sm`}>
            ← Toutes les réservations
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="font-display-optical text-display-sm">{booking.reference}</h1>
            <StatusBadge status={booking.status} />
          </div>
          <p className="text-lg">
            Prise en charge le{" "}
            <time dateTime={pickup.toISOString()} className="font-semibold">
              {formatParisDateTime(pickup)}
            </time>{" "}
            <span className="text-sm text-graphite">
              (heure de Paris, {formatParisOffset(pickup)})
            </span>
          </p>
        </header>

        <Section title="Trajet">
          <RouteLine
            committed
            label="Itinéraire"
            legLabel="Trajet routier du devis"
            stops={[
              {
                label: booking.pickupLabel,
                legToNext: {
                  distance: formatDistance(booking.quotedDistanceMeters),
                  duration: formatDuration(booking.quotedDurationSeconds),
                },
              },
              { label: booking.dropoffLabel },
            ]}
          />
          <Facts>
            <Fact label="Passagers">{booking.passengerCount}</Fact>
            <Fact label="Bagages">{booking.luggageCount}</Fact>
          </Facts>
        </Section>

        {booking.transportKind ? (
          <Section title={`Arrivée en ${booking.transportKind === "FLIGHT" ? "avion" : "train"}`}>
            <Facts>
              <Fact label={TRANSPORT_LABELS[booking.transportKind]}>
                {booking.transportNumber ?? MISSING}
              </Fact>
              <Fact label="Provenance">{booking.transportOrigin ?? MISSING}</Fact>
              <Fact label="Terminal / point de rencontre">
                {booking.transportTerminal ?? MISSING}
              </Fact>
              <Fact label="Arrivée prévue">
                {booking.transportScheduledAt ? (
                  <DateTime instant={booking.transportScheduledAt} />
                ) : (
                  MISSING
                )}
              </Fact>
            </Facts>
          </Section>
        ) : null}

        <Section title="Montant">
          <Facts>
            <Fact label="Total TTC">
              <span className="font-display-figure text-xl">
                {formatAmount(booking.totalTtcCents, booking.currency)}
              </span>
            </Fact>
            <Fact label="HT">{formatAmount(booking.totalHtCents, booking.currency)}</Fact>
            <Fact label="TVA">{formatAmount(booking.vatCents, booking.currency)}</Fact>
            <Fact label="Règle tarifaire">version {booking.pricingRuleVersion}</Fact>
          </Facts>
          <p className="text-sm text-graphite">
            Montants enregistrés au devis, jamais recalculés ici. HT et TVA : « — » tant que le taux
            n’est pas fixé.
          </p>
        </Section>

        <Section title="Client">
          <Facts>
            <Fact label="Nom">{booking.contact.name}</Fact>
            <Fact label="Téléphone">
              {booking.contact.phone ? (
                <a href={`tel:${booking.contact.phone}`} className={textLinkClasses}>
                  {booking.contact.phone}
                </a>
              ) : (
                MISSING
              )}
            </Fact>
            <Fact label="Email">
              <a
                href={`mailto:${booking.customerEmail}`}
                className={`${textLinkClasses} break-all`}
              >
                {booking.customerEmail}
              </a>
            </Fact>
            <Fact label="Langue">{LOCALE_LABELS[booking.contact.locale]}</Fact>
          </Facts>
          <p className="text-sm text-graphite">
            {booking.contact.source === "booking"
              ? "Coordonnées saisies avec cette réservation."
              : "Coordonnées du profil client (réservation antérieure à la copie par réservation)."}
          </p>
        </Section>

        <Section title="Notes">
          <div className="grid gap-4 sm:grid-cols-2">
            <Note title="Note du client" hint="Saisie par le client, visible par lui.">
              {booking.customerNotes}
            </Note>
            <Note title="Note interne" hint="Équipe uniquement, jamais montrée au client.">
              {booking.internalNotes}
            </Note>
          </div>
        </Section>

        <Section title="Historique">
          <AuditTrail entries={booking.audit} />
          <Facts>
            <Fact label="Créée le">
              <DateTime instant={booking.createdAt} />
            </Fact>
            <Fact label="Modifiée le">
              <DateTime instant={booking.updatedAt} />
            </Fact>
            {booking.cancelledAt ? (
              <Fact label="Annulée le">
                <DateTime instant={booking.cancelledAt} />
              </Fact>
            ) : null}
            {booking.completedAt ? (
              <Fact label="Terminée le">
                <DateTime instant={booking.completedAt} />
              </Fact>
            ) : null}
          </Facts>
        </Section>
      </article>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-5">
      <h2 className="small-caps-label text-graphite">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-graphite">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Note({ title, hint, children }: { title: string; hint: string; children: string | null }) {
  return (
    <div className="flex flex-col gap-2 border border-hairline p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-graphite">{hint}</p>
      <p className="whitespace-pre-line">{children ?? "Aucune."}</p>
    </div>
  );
}

function DateTime({ instant }: { instant: Date }) {
  return <time dateTime={instant.toISOString()}>{formatParisDateTime(instant)}</time>;
}

function AuditTrail({ entries }: { entries: readonly BookingAuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-graphite">Aucune action enregistrée pour cette réservation.</p>;
  }
  return (
    <ol className="flex flex-col border-l border-rule pl-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative flex flex-col gap-0.5 pb-5 last:pb-0">
          <span
            aria-hidden="true"
            className="absolute top-2 -left-[calc(1.25rem+3.5px)] size-[7px] rounded-full bg-ink"
          />
          <span className="text-sm text-graphite">
            <DateTime instant={entry.createdAt} /> · {formatParisOffset(entry.createdAt)}
          </span>
          <span className="font-semibold">
            {entry.fromStatus && entry.toStatus
              ? `${STATUS_LABELS[entry.fromStatus]} → ${STATUS_LABELS[entry.toStatus]}`
              : entry.toStatus
                ? STATUS_LABELS[entry.toStatus]
                : entry.action}
          </span>
          <span className="text-sm">
            {ACTOR_LABELS[entry.actorType]}
            {entry.actorName ? ` · ${entry.actorName}` : ""}
            <span className="text-graphite"> · {entry.action}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
