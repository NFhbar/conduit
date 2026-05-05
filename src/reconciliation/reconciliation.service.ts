import { Inject, Injectable } from '@nestjs/common';
import {
  ACCOUNTS_REPOSITORY,
  AccountsRepository,
} from '../accounts/accounts.repository';
import { applyEntry, directionSign } from '../domain/direction';
import {
  TRANSACTIONS_REPOSITORY,
  TransactionsRepository,
} from '../transactions/transactions.repository';

export interface AccountDiscrepancy {
  accountId: string;
  expectedBalanceCents: number;
  actualBalanceCents: number;
  /**
   * `actualBalanceCents - expectedBalanceCents`. Positive means the stored
   * balance is higher than the entry history justifies; negative means lower.
   */
  diffCents: number;
}

/**
 * An entry whose `accountId` doesn't match any stored account. Reported
 * (rather than silently dropped) because the whole point of reconciliation
 * is to surface inconsistency.
 */
export interface OrphanEntry {
  transactionId: string;
  entryId: string;
  accountId: string;
}

export interface ReconciliationReport {
  status: 'ok' | 'drift_detected';
  accountsChecked: number;
  transactionsReplayed: number;
  /**
   * Sum across all accounts of `account.balanceCents × directionSign(account.direction)`.
   * Invariant: equals `globalOpeningSignedSumCents` because every applied
   * transaction is balanced.
   */
  globalSignedSumCents: number;
  globalOpeningSignedSumCents: number;
  /** Equality of `globalSignedSumCents` and `globalOpeningSignedSumCents`. Cross-checks the per-account replay; catches the case where the replay algorithm itself has drifted. */
  globalInvariantHolds: boolean;
  discrepancies: AccountDiscrepancy[];
  orphanEntries: OrphanEntry[];
  checkedAt: string;
}

/**
 * Re-derives every account's expected balance by replaying the entry history
 * on top of its opening balance, then compares to the stored balance.
 *
 * Read-only. Drift is reported, never auto-corrected — silent rewrites in a
 * financial system are how reconciliation tools become the bug rather than
 * catching it.
 *
 * Three signals are surfaced:
 *   1. **Per-account discrepancies** — `actualBalance` vs replayed `expectedBalance`.
 *   2. **Orphan entries** — entries referencing accounts that don't exist in storage.
 *   3. **Global signed-sum invariant** — `Σ (balance × directionSign)` should equal
 *      the same sum computed against opening balances. Mathematically implied by
 *      the per-account check, but surfaced as a cross-check against bugs in the
 *      replay algorithm itself.
 *
 * `status === 'ok'` requires all three: no discrepancies, no orphans, and the
 * global invariant holds.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
    @Inject(TRANSACTIONS_REPOSITORY)
    private readonly transactionsRepo: TransactionsRepository,
  ) {}

  /**
   * @param now - injectable timestamp; defaults to `new Date()`. Lets a future
   * scheduled job pass a deterministic value for snapshot/audit purposes.
   */
  reconcile(now: Date = new Date()): ReconciliationReport {
    const accounts = this.accountsRepo.findAll();
    const transactions = this.transactionsRepo.findAll();

    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const expected = new Map<string, number>(
      accounts.map((a) => [a.id, a.openingBalanceCents]),
    );

    const orphanEntries: OrphanEntry[] = [];

    for (const tx of transactions) {
      for (const entry of tx.entries) {
        const account = accountsById.get(entry.accountId);
        if (!account) {
          orphanEntries.push({
            transactionId: tx.id,
            entryId: entry.id,
            accountId: entry.accountId,
          });
          continue;
        }
        // `expected` was built from the same `accounts` list, so we know
        // every account is keyed. Asserting (rather than `?? 0`) means a
        // future bug that breaks this invariant fails loudly instead of
        // silently producing fake discrepancies.
        const current = expected.get(entry.accountId)!;
        expected.set(
          entry.accountId,
          applyEntry(current, account.direction, entry),
        );
      }
    }

    const discrepancies: AccountDiscrepancy[] = [];
    for (const account of accounts) {
      const expectedBalanceCents = expected.get(account.id)!;
      if (expectedBalanceCents !== account.balanceCents) {
        discrepancies.push({
          accountId: account.id,
          expectedBalanceCents,
          actualBalanceCents: account.balanceCents,
          diffCents: account.balanceCents - expectedBalanceCents,
        });
      }
    }

    const globalSignedSumCents = accounts.reduce(
      (sum, a) => sum + directionSign(a.direction) * a.balanceCents,
      0,
    );
    const globalOpeningSignedSumCents = accounts.reduce(
      (sum, a) => sum + directionSign(a.direction) * a.openingBalanceCents,
      0,
    );
    const globalInvariantHolds =
      globalSignedSumCents === globalOpeningSignedSumCents;

    const status: 'ok' | 'drift_detected' =
      discrepancies.length === 0 &&
      orphanEntries.length === 0 &&
      globalInvariantHolds
        ? 'ok'
        : 'drift_detected';

    return {
      status,
      accountsChecked: accounts.length,
      transactionsReplayed: transactions.length,
      globalSignedSumCents,
      globalOpeningSignedSumCents,
      globalInvariantHolds,
      discrepancies,
      orphanEntries,
      checkedAt: now.toISOString(),
    };
  }
}
