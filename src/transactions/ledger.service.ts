import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Account, withBalance } from '../accounts/account.entity';
import {
  ACCOUNTS_REPOSITORY,
  AccountsRepository,
} from '../accounts/accounts.repository';
import { Page, PageQuery } from '../common/pagination';
import {
  DuplicateIdError,
  EntityNotFoundError,
  StaleVersionError,
} from '../common/repository-errors';
import { isBalanced } from '../domain/balance-rules';
import { applyEntry } from '../domain/direction';
import { Direction } from '../domain/direction';
import { dollarsToCents } from '../domain/money';
import { Entry } from './entry.entity';
import { Transaction } from './transaction.entity';
import {
  TRANSACTIONS_REPOSITORY,
  TransactionsRepository,
} from './transactions.repository';

export interface CreateEntryInput {
  id?: string;
  accountId: string;
  direction: Direction;
  /** Amount in dollars. */
  amount: number;
}

export interface CreateTransactionInput {
  id?: string;
  name?: string;
  entries: CreateEntryInput[];
}

@Injectable()
export class LedgerService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
    @Inject(TRANSACTIONS_REPOSITORY)
    private readonly transactionsRepo: TransactionsRepository,
  ) {}

  /**
   * Validates a transaction in full and applies it atomically: either every
   * referenced account is updated, or none is.
   *
   * Atomicity here depends on every repository method being synchronous —
   * the commit loop completes between event-loop turns, so no other handler
   * can observe a half-applied transaction. See `AccountsRepository` for the
   * sync-only constraint. Under a real DB this whole method becomes the body
   * of a SQL transaction / row-lock scope.
   *
   * @param input - transaction payload validated by the controller's DTO.
   * @param now   - injectable clock; defaults to `new Date()`. The single
   *   `now` flows to `transaction.createdAt`, every `entry.createdAt`, and
   *   the `updatedAt` of every account this transaction touches — so the
   *   audit story is "this whole transaction happened at one instant",
   *   which is what the atomicity guarantee already promises.
   */
  applyTransaction(
    input: CreateTransactionInput,
    now: Date = new Date(),
  ): Transaction {
    const id = input.id ?? uuid();
    if (this.transactionsRepo.findById(id)) {
      throw new ConflictException(`transaction ${id} already exists`);
    }

    if (input.entries.length < 2) {
      throw new BadRequestException(
        'transaction must have at least two entries',
      );
    }

    const nowIso = now.toISOString();
    const entries: Entry[] = input.entries.map((entry) => ({
      id: entry.id ?? uuid(),
      transactionId: id,
      accountId: entry.accountId,
      direction: entry.direction,
      amountCents: this.toCents(entry.amount),
      createdAt: nowIso,
    }));

    for (const entry of entries) {
      if (entry.amountCents <= 0) {
        throw new BadRequestException('entry amount must be greater than zero');
      }
    }

    if (!isBalanced(entries)) {
      throw new BadRequestException('transaction is not balanced');
    }

    // Resolve every referenced account up front. Throws if any is missing —
    // before any balance has been mutated.
    const accountsById = new Map<string, Account>();
    for (const entry of entries) {
      if (accountsById.has(entry.accountId)) continue;
      const account = this.accountsRepo.findById(entry.accountId);
      if (!account) {
        throw new NotFoundException(`account ${entry.accountId} not found`);
      }
      accountsById.set(entry.accountId, account);
    }

    // Compute new balances in memory; multiple entries on the same account
    // accumulate. Every touched account's `updatedAt` advances to the same
    // `nowIso` — the whole transaction happens at one instant.
    for (const entry of entries) {
      const current = accountsById.get(entry.accountId)!;
      const updated = withBalance(
        current,
        applyEntry(current.balanceCents, current.direction, entry),
        nowIso,
      );
      accountsById.set(entry.accountId, updated);
    }

    // Commit phase. Repository throws are translated into HTTP exceptions:
    //   - `EntityNotFoundError` (account vanished between pre-fetch and update) → 404
    //   - `StaleVersionError`  (account changed under us between read and commit) → 409
    //   - `DuplicateIdError`   (transaction id raced our pre-check) → 409
    // Today the first two are unreachable in single-threaded Node + synchronous
    // repos; the translation guards any future async backend or multi-worker
    // deployment without LedgerService having to change.
    //
    // Partial-commit caveat: under a future async backend, a mid-loop throw
    // (e.g. the third of five `update` calls hitting a stale version) would
    // leave the earlier accounts committed without a transaction record. The
    // version check makes this *loud* (a 409 instead of a silent overwrite),
    // but the eventual fix is wrapping this whole block in a SQL transaction
    // / `dataSource.transaction(...)` so the partial state never persists.
    try {
      for (const account of accountsById.values()) {
        this.accountsRepo.update(account);
      }
      const transaction: Transaction = {
        id,
        name: input.name,
        entries,
        createdAt: nowIso,
      };
      this.transactionsRepo.create(transaction);
      return transaction;
    } catch (err) {
      if (err instanceof EntityNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof StaleVersionError) {
        throw new ConflictException(err.message);
      }
      if (err instanceof DuplicateIdError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  /**
   * Pass-through to the transactions repository. Same reasoning as
   * `AccountsService.list`: kept on the service so every controller-to-data
   * path is service-mediated; the natural place for auth-scoping or
   * per-request logging when those land.
   */
  list(query: PageQuery): Page<Transaction> {
    return this.transactionsRepo.findPage(query);
  }

  /**
   * Account history. Verifies the account exists (so the response is a
   * 404 instead of a misleading empty page) and returns the entries that
   * touch it, newest-first.
   */
  findEntriesByAccountId(accountId: string, query: PageQuery): Page<Entry> {
    if (!this.accountsRepo.findById(accountId)) {
      throw new NotFoundException(`account ${accountId} not found`);
    }
    return this.transactionsRepo.findEntriesByAccountId(accountId, query);
  }

  private toCents(value: number): number {
    try {
      return dollarsToCents(value);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}
