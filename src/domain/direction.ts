export type Direction = 'debit' | 'credit';

/**
 * The sign a direction contributes to the global signed-balance sum.
 * Debit accounts contribute positively, credit accounts negatively, so that
 * `Σ (account.balanceCents × directionSign(account.direction))` is invariant
 * under any sequence of balanced transactions.
 */
export function directionSign(direction: Direction): 1 | -1 {
  return direction === 'debit' ? 1 : -1;
}

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
