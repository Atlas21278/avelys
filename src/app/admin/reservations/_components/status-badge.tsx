import { type BookingStatus, FINAL_BOOKING_STATUSES } from "@/domain/booking/status";
import { cx } from "@/lib/cx";

import { STATUS_LABELS } from "./format";

/** Status tag. A request waiting for a decision is solid ink; closed bookings recede. */
export function StatusBadge({ status }: { status: BookingStatus }) {
  const final = (FINAL_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-print border px-2 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap",
        status === "REQUESTED"
          ? "border-ink bg-ink text-paper"
          : final
            ? "border-hairline text-graphite"
            : "border-ink text-ink",
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
