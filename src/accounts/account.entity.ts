import { Direction } from '../domain/direction';

export interface Account {
  readonly id: string;
  readonly direction: Direction;
  readonly name?: string;
  /**
   * Opening balance in cents, captured at creation time. Immutable for the
   * lifetime of the account. Reconciliation replays the entry history on top
   * of this value to verify `balanceCents` is derivable from the ledger.
   */
  readonly openingBalanceCents: number;
  readonly balanceCents: number;
  /**
   * Optimistic-concurrency version. Read alongside the rest of the account
   * state; the repository's `update` only succeeds when the stored version
   * matches the version embedded here. Bumped by one on every successful
   * write. The "I observed N, please write only if you're still at N"
   * contract — same shape SQL would express as
   * `UPDATE … WHERE id = ? AND version = ?`.
   */
  readonly version: number;
  /** ISO 8601 timestamp captured at creation. Immutable. */
  readonly createdAt: string;
  /**
   * ISO 8601 timestamp of the most recent balance commit. Equals `createdAt`
   * for an account that has never participated in a transaction; advances
   * on every successful balance update.
   */
  readonly updatedAt: string;
}

/**
 * Value-level update that replaces `balanceCents` and `updatedAt`.
 * Preserves every other field — crucially `version`, so the returned
 * account still represents the version observed at read time (the
 * repository bumps the version on commit). The new timestamp is taken
 * as an explicit argument rather than read from a hidden clock, so the
 * service is the single place that materializes "now" into entities.
 */
export function withBalance(
  account: Account,
  balanceCents: number,
  updatedAt: string,
): Account {
  return { ...account, balanceCents, updatedAt };
}
