import { Page, PageQuery } from '../common/pagination';
import { Account } from './account.entity';

export const ACCOUNTS_REPOSITORY = 'ACCOUNTS_REPOSITORY';

/**
 * Synchronous storage interface for accounts.
 *
 * Synchronous on purpose: `LedgerService.applyTransaction` relies on the fact
 * that the validate-then-commit phase cannot be interrupted by the event loop.
 * Adding a `Promise<...>` return type to any method on this interface
 * silently breaks atomicity. Real-database implementations should keep this
 * signature and accept a `(work) => result` transactional callback as a
 * separate port if they need async I/O.
 *
 * Implementations throw `DuplicateIdError` / `EntityNotFoundError` from
 * `src/common/repository-errors`; services translate to HTTP exceptions.
 */
export interface AccountsRepository {
  /** Persist a new account. Throws `DuplicateIdError` if `account.id` already exists. */
  create(account: Account): void;

  findById(id: string): Account | undefined;

  /**
   * Sweep API: returns every stored account in one call. Used by
   * `ReconciliationService` to replay the entry history, where the full
   * set is genuinely needed in memory to compute the global signed-sum
   * invariant — pagination wouldn't help.
   *
   * **Not** the right call for HTTP listing endpoints; those use `findPage`
   * (below) so the unbounded-fetch hazard stays contained to reconciliation.
   * A SQL implementation of this sweep variant should still consider
   * streaming/cursoring rather than materializing the whole table.
   */
  findAll(): Account[];

  /**
   * Paginated listing for HTTP consumers. Sort order is `createdAt`
   * descending (newest first) — stable per the immutable `createdAt`
   * field, with `id` as the tiebreaker for accounts created in the same
   * millisecond.
   *
   * Two trade-offs the SQL implementer should plan for:
   *
   *  - **Offset shift under inserts.** Between two paginated requests, a
   *    new row inserted at the top of the sort order shifts every offset
   *    by one. Newest-first + append-only writes biases the failure mode
   *    toward "skip" — page 2 can miss a row a client already saw on
   *    page 1. Cursor-based pagination (`(createdAt, id)` cursor) is the
   *    sturdier shape; flagged in `Future improvements`.
   *  - **Exact `total` cost.** Returning `total` on every page is free for
   *    the in-memory `Map` (the iteration is the source) but costs a
   *    `SELECT COUNT(*)` per request under SQL. For large tables that's
   *    the canonical pagination performance hazard. Worth deciding before
   *    the SQL impl lands whether to keep `total` exact or switch the
   *    contract to `hasMore: boolean`.
   */
  findPage(query: PageQuery): Page<Account>;

  /**
   * Replace an existing account, version-checked.
   *
   * Throws `EntityNotFoundError` if the id is unknown, or `StaleVersionError`
   * if the stored version doesn't match `account.version` — the optimistic-
   * concurrency contract: callers pass the account they read (carrying the
   * version they observed), and the repository commits only if no concurrent
   * writer has intervened. On success, the stored row is written with
   * `version + 1`.
   *
   * Sole legitimate caller is `LedgerService.applyTransaction` committing a
   * balance change. `AccountsService` is intentionally not a writer of
   * post-creation account state — keeping the rule "balances mutate only
   * through transactions" enforceable from one place.
   */
  update(account: Account): void;
}
