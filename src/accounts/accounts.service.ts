import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Page, PageQuery } from '../common/pagination';
import { DuplicateIdError } from '../common/repository-errors';
import { Direction } from '../domain/direction';
import { dollarsToCents } from '../domain/money';
import { Account } from './account.entity';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from './accounts.repository';

export interface CreateAccountInput {
  id?: string;
  direction: Direction;
  name?: string;
  /** Initial balance in dollars. Defaults to 0. */
  balance?: number;
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly repo: AccountsRepository,
  ) {}

  /**
   * @param now - injectable clock; defaults to `new Date()`. Tests pass a
   * deterministic value so timestamp assertions don't have to chase wall time.
   */
  create(input: CreateAccountInput, now: Date = new Date()): Account {
    const id = input.id ?? uuid();
    if (this.repo.findById(id)) {
      throw new ConflictException(`account ${id} already exists`);
    }

    let balanceCents: number;
    try {
      balanceCents = dollarsToCents(input.balance ?? 0);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const nowIso = now.toISOString();
    const account: Account = {
      id,
      direction: input.direction,
      name: input.name,
      openingBalanceCents: balanceCents,
      balanceCents,
      version: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      this.repo.create(account);
    } catch (err) {
      if (err instanceof DuplicateIdError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
    return account;
  }

  findById(id: string): Account {
    const account = this.repo.findById(id);
    if (!account) {
      throw new NotFoundException(`account ${id} not found`);
    }
    return account;
  }

  /**
   * One-line pass-through to the repository today, but kept on the service
   * so every controller-to-data path goes through one mediation layer.
   * The natural place for auth-scoping (filter by `tenantId`), per-request
   * logging, or cache lookups when those land — all of which would be
   * surprising in a controller.
   */
  list(query: PageQuery): Page<Account> {
    return this.repo.findPage(query);
  }
}
