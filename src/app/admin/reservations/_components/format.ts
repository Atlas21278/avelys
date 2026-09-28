import type { BookingStatus } from "@/domain/booking/status";
import type { BookingActor } from "@/domain/booking/transitions";
import { CURRENCIES, type Currency, formatMoney, money } from "@/lib/money";

// Display helpers of the back-office booking screens (French, like the rest of /admin).

export const STATUS_LABELS: Record<BookingStatus, string> = {
  REQUESTED: "À traiter",
  ACCEPTED: "Acceptée",
  REFUSED: "Refusée",
  CANCELLED: "Annulée",
  CONFIRMED: "Confirmée",
  DRIVER_ASSIGNED: "Chauffeur affecté",
  IN_PROGRESS: "En cours",
  NO_SHOW: "Client absent",
  COMPLETED: "Terminée",
};

export const ACTOR_LABELS: Record<BookingActor, string> = {
  CUSTOMER: "Client",
  ADMIN: "Administrateur",
  DISPATCHER: "Dispatch",
  DRIVER: "Chauffeur",
  SYSTEM: "Système",
};

export const TRANSPORT_LABELS = { FLIGHT: "Vol", TRAIN: "Train" } as const;

export const LOCALE_LABELS = { fr: "Français", en: "Anglais" } as const;

/** Placeholder for a value that is not known yet (e.g. HT and VAT while DEC-04 is open). */
export const MISSING = "—";

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Formats stored integer cents; never recomputes an amount. */
export function formatAmount(cents: number | null, currency: string): string {
  if (cents === null) return MISSING;
  if (isCurrency(currency)) return formatMoney(money(cents, currency), "fr");
  // Unknown currency: show the stored minor units as they are rather than guess a format.
  return `${cents} (centimes ${currency})`;
}

export function formatDistance(meters: number): string {
  const km = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(meters / 1000);
  return `${km} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, "0")}`;
}

export function formatCount(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}
