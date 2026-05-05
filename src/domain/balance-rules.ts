import { EntryLike } from './direction';

/**
 * A transaction is balanced when the sum of debit-entry amounts equals
 * the sum of credit-entry amounts. Operates on integer cents to avoid
 * floating-point comparison hazards.
 */
export function isBalanced(entries: ReadonlyArray<EntryLike>): boolean {
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    if (entry.direction === 'debit') {
      debits += entry.amountCents;
    } else {
      credits += entry.amountCents;
    }
  }
  return debits === credits;
}
