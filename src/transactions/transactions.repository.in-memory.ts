import { Injectable } from '@nestjs/common';
import { Page, PageQuery } from '../common/pagination';
import { DuplicateIdError } from '../common/repository-errors';
import { Entry } from './entry.entity';
import { Transaction } from './transaction.entity';
import { TransactionsRepository } from './transactions.repository';

@Injectable()
export class InMemoryTransactionsRepository implements TransactionsRepository {
  private readonly store = new Map<string, Transaction>();

  create(transaction: Transaction): void {
    if (this.store.has(transaction.id)) {
      throw new DuplicateIdError('transaction', transaction.id);
    }
    this.store.set(transaction.id, transaction);
  }

  findById(id: string): Transaction | undefined {
    return this.store.get(id);
  }

  findAll(): Transaction[] {
    return Array.from(this.store.values());
  }

  findPage(query: PageQuery): Page<Transaction> {
    const sorted = Array.from(this.store.values()).sort(
      byTransactionCreatedAtDescThenId,
    );
    const items = sorted.slice(query.offset, query.offset + query.limit);
    return {
      items,
      total: sorted.length,
      offset: query.offset,
      limit: query.limit,
    };
  }

  findEntriesByAccountId(accountId: string, query: PageQuery): Page<Entry> {
    const matches: Entry[] = [];
    for (const tx of this.store.values()) {
      for (const entry of tx.entries) {
        if (entry.accountId === accountId) matches.push(entry);
      }
    }
    matches.sort(byEntryCreatedAtDescThenId);
    return {
      items: matches.slice(query.offset, query.offset + query.limit),
      total: matches.length,
      offset: query.offset,
      limit: query.limit,
    };
  }
}

function byTransactionCreatedAtDescThenId(
  a: Transaction,
  b: Transaction,
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id.localeCompare(b.id);
}

function byEntryCreatedAtDescThenId(a: Entry, b: Entry): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id.localeCompare(b.id);
}
