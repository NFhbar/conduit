import { Injectable } from '@nestjs/common';
import {
  DuplicateIdError,
  EntityNotFoundError,
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

  findById(id: string): Account | undefined {
    return this.store.get(id);
  }

  update(account: Account): void {
    if (!this.store.has(account.id)) {
      throw new EntityNotFoundError('account', account.id);
    }
    this.store.set(account.id, account);
  }
}
