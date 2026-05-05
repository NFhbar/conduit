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
   * Replace an existing account. Throws `EntityNotFoundError` if id is unknown.
   *
   * Sole legitimate caller is `LedgerService.applyTransaction` committing a
   * balance change. `AccountsService` is intentionally not a writer of
   * post-creation account state — keeping the rule "balances mutate only
   * through transactions" enforceable from one place.
   */
  update(account: Account): void;
}
