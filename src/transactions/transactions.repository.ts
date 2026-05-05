import { Page, PageQuery } from '../common/pagination';
import { Entry } from './entry.entity';
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

  /**
   * Sweep API: returns every stored transaction in one call. Same contract
   * as `AccountsRepository.findAll` — used by reconciliation, not the right
   * shape for a paginated HTTP listing endpoint.
   */
  findAll(): Transaction[];

  /**
   * Paginated transaction listing. Sorted by `createdAt` descending (newest
   * first), with `id` as tiebreaker. Same offset-shift and `total`-cost
   * trade-offs as `AccountsRepository.findPage` — see that doc comment.
   */
  findPage(query: PageQuery): Page<Transaction>;

  /**
   * Account history: every entry that touches `accountId`, paginated,
   * sorted by entry `createdAt` descending.
   *
   * Cost shape: the in-memory implementation iterates *every* transaction
   * and *every* entry on each call (`O(N × E)`), then sorts the matches.
   * Pagination doesn't help — every page replays the full scan. A SQL
   * implementation indexed on `entries.account_id` reduces this to a
   * direct seek + `LIMIT/OFFSET`, which is the right shape once thousands
   * of transactions × ~2 entries each × 50 paginated calls becomes a real
   * workload. v1 is intentional; the optimization rides with the
   * persistence swap.
   */
  findEntriesByAccountId(accountId: string, query: PageQuery): Page<Entry>;
}
