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
import {
  DuplicateIdError,
  EntityNotFoundError,
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
   */
  applyTransaction(input: CreateTransactionInput): Transaction {
    const id = input.id ?? uuid();
    if (this.transactionsRepo.findById(id)) {
      throw new ConflictException(`transaction ${id} already exists`);
    }

    if (input.entries.length < 2) {
      throw new BadRequestException(
        'transaction must have at least two entries',
      );
    }

    const entries: Entry[] = input.entries.map((entry) => ({
      id: entry.id ?? uuid(),
      accountId: entry.accountId,
      direction: entry.direction,
      amountCents: this.toCents(entry.amount),
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
    // accumulate.
    for (const entry of entries) {
      const current = accountsById.get(entry.accountId)!;
      const updated = withBalance(
        current,
        applyEntry(current.balanceCents, current.direction, entry),
      );
      accountsById.set(entry.accountId, updated);
    }

    // Commit phase. Both repository calls translate their typed errors into
    // HTTP exceptions: `EntityNotFoundError` (account vanished between the
    // pre-fetch above and this update) → 404; `DuplicateIdError` (transaction
    // id raced our pre-check) → 409. Today both throws are unreachable in a
    // single-threaded run; the translation guards a future async backend.
    try {
      for (const account of accountsById.values()) {
        this.accountsRepo.update(account);
      }
      const transaction: Transaction = { id, name: input.name, entries };
      this.transactionsRepo.create(transaction);
      return transaction;
    } catch (err) {
      if (err instanceof EntityNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof DuplicateIdError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  private toCents(value: number): number {
    try {
      return dollarsToCents(value);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}
