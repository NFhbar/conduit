import { Injectable } from '@nestjs/common';
import { Page, PageQuery } from '../common/pagination';
import {
  DuplicateIdError,
  EntityNotFoundError,
  StaleVersionError,
} from '../common/repository-errors';
import { Account } from './account.entity';
import { AccountsRepository } from './accounts.repository';

@Injectable()
export class InMemoryAccountsRepository implements AccountsRepository {
  private readonly store = new Map<string, Account>();

  create(account: Account): void {
    if (this.store.has(account.id)) {
      throw new DuplicateIdError('account', account.id);
    }
    this.store.set(account.id, account);
  }

  /**
   * Returns the stored account *by reference* — same object pointer the
   * `Map` holds. Callers must treat the result as immutable; mutating it
   * would silently corrupt the store. The codebase already does (`Account`
   * fields are `readonly` and the only writer goes through `update`), but
   * `readonly` is structural so this is a latent foot-gun without a
   * defensive clone. A SQL backend materializes a fresh object per call
   * and makes this concern moot.
   */
  findById(id: string): Account | undefined {
    return this.store.get(id);
  }

  findAll(): Account[] {
    return Array.from(this.store.values());
  }

  findPage(query: PageQuery): Page<Account> {
    const sorted = Array.from(this.store.values()).sort(byCreatedAtDescThenId);
    const items = sorted.slice(query.offset, query.offset + query.limit);
    return {
      items,
      total: sorted.length,
      offset: query.offset,
      limit: query.limit,
    };
  }

  /**
   * Optimistic-concurrency commit.
   *
   * The contract:
   *  1. If the row doesn't exist, throw `EntityNotFoundError`.
   *  2. If the stored row's version doesn't match `account.version`, throw
   *     `StaleVersionError` — another writer has intervened since the caller
   *     read.
   *  3. Otherwise, write the new state with `version: stored.version + 1`.
   *     The caller's `account.version` is *not* preserved; the repo owns
   *     the version timeline.
   *
   * In single-threaded Node with synchronous handlers, (2) is unreachable
   * today; the check is the seam that makes the contract correct under any
   * future async backend or multi-worker deployment without changing
   * `LedgerService`.
   */
  update(account: Account): void {
    const stored = this.store.get(account.id);
    if (!stored) {
      throw new EntityNotFoundError('account', account.id);
    }
    if (stored.version !== account.version) {
      throw new StaleVersionError(
        'account',
        account.id,
        account.version,
        stored.version,
      );
    }
    this.store.set(account.id, { ...account, version: stored.version + 1 });
  }
}

function byCreatedAtDescThenId(a: Account, b: Account): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  // `id` ties are unreachable today because Map keys are unique, but
  // `localeCompare` keeps the comparator honest (always returns -1/0/1).
  return a.id.localeCompare(b.id);
}
