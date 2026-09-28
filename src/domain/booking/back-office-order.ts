/**
 * Order of the back-office booking list (Master Spec §14): `REQUESTED` bookings first, then all
 * the others; each group by pickup instant. The list is read as two ordered segments (priority,
 * then rest) so each query stays a plain indexed `ORDER BY pickupAt`. This module only computes
 * which slice of each segment a page covers.
 */

/** A slice of one ordered segment. */
export interface SegmentSlice {
  readonly skip: number;
  readonly take: number;
}

export interface PrioritySplit {
  /** Slice of the priority segment, null when the page shows none of it. */
  readonly priority: SegmentSlice | null;
  /** Slice of the remaining segment, null when the page shows none of it. */
  readonly rest: SegmentSlice | null;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

/**
 * Splits the window `[offset, offset + limit)` of the concatenation (priority segment of
 * `priorityCount` rows, then the rest) into one slice per segment.
 */
export function splitPriorityPage(
  priorityCount: number,
  offset: number,
  limit: number,
): PrioritySplit {
  assertNonNegativeInteger(priorityCount, "priorityCount");
  assertNonNegativeInteger(offset, "offset");
  assertNonNegativeInteger(limit, "limit");
  if (limit === 0) return { priority: null, rest: null };

  const priorityTake = Math.max(0, Math.min(limit, priorityCount - offset));
  const priority = priorityTake > 0 ? { skip: offset, take: priorityTake } : null;

  const restTake = limit - priorityTake;
  const rest = restTake > 0 ? { skip: Math.max(0, offset - priorityCount), take: restTake } : null;

  return { priority, rest };
}
