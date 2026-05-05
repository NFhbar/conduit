import { Transaction } from './transaction.entity';

export const TRANSACTIONS_REPOSITORY = 'TRANSACTIONS_REPOSITORY';

/**
 * Synchronous storage interface for transactions.
 *
 * Synchronous on purpose: see `AccountsRepository` for the atomicity rationale.
 * Implementations throw `DuplicateIdError` from `src/common/repository-errors`;
 * `LedgerService` translates to HTTP exceptions.
 */
export interface TransactionsRepository {
  /** Persist a new transaction. Throws `DuplicateIdError` if `transaction.id` already exists. */
  create(transaction: Transaction): void;

  findById(id: string): Transaction | undefined;
}
