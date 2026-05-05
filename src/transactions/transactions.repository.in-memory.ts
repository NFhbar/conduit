import { Injectable } from '@nestjs/common';
import { DuplicateIdError } from '../common/repository-errors';
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
}
