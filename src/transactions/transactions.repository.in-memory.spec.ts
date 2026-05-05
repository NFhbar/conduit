import { DuplicateIdError } from '../common/repository-errors';
import { randomUuid } from '../testing/factories';
import { Transaction } from './transaction.entity';
import { InMemoryTransactionsRepository } from './transactions.repository.in-memory';

describe('InMemoryTransactionsRepository', () => {
  function buildTransaction(): Transaction {
    return { id: randomUuid(), entries: [] };
  }

  it('throws DuplicateIdError on create when id already exists', () => {
    const repo = new InMemoryTransactionsRepository();
    const tx = buildTransaction();
    repo.create(tx);
    expect(() => repo.create(tx)).toThrow(DuplicateIdError);
  });

  it('returns undefined from findById when id is unknown', () => {
    const repo = new InMemoryTransactionsRepository();
    expect(repo.findById(randomUuid())).toBeUndefined();
  });

  it('returns the stored transaction by id after create', () => {
    const repo = new InMemoryTransactionsRepository();
    const tx = buildTransaction();
    repo.create(tx);
    expect(repo.findById(tx.id)).toEqual(tx);
  });
});
