export type Direction = 'debit' | 'credit';

export interface EntryLike {
  direction: Direction;
  amountCents: number;
}

/**
 * Applies an entry to a balance and returns the new balance.
 *
 * Rule: same direction adds, opposite direction subtracts. The sign of the
 * resulting balance is meaningful for both account directions.
 */
export function applyEntry(
  currentBalanceCents: number,
  accountDirection: Direction,
  entry: EntryLike,
): number {
  const delta =
    accountDirection === entry.direction
      ? entry.amountCents
      : -entry.amountCents;
  return currentBalanceCents + delta;
}
