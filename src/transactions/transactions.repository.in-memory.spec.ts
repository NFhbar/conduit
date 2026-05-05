import { DuplicateIdError } from '../common/repository-errors';
import { randomUuid } from '../testing/factories';
import { Transaction } from './transaction.entity';
import { InMemoryTransactionsRepository } from './transactions.repository.in-memory';

describe('InMemoryTransactionsRepository', () => {
  function buildTransaction(): Transaction {
    return {
      id: randomUuid(),
      entries: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
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

  it('returns every stored transaction from findAll', () => {
    const repo = new InMemoryTransactionsRepository();
    expect(repo.findAll()).toEqual([]);

    const tx1 = buildTransaction();
    const tx2 = buildTransaction();
    repo.create(tx1);
    repo.create(tx2);

    const all = repo.findAll();
    expect(all).toHaveLength(2);
    expect(all.map((tx) => tx.id).sort()).toEqual([tx1.id, tx2.id].sort());
  });

  it('paginates findPage in newest-first order', () => {
    const repo = new InMemoryTransactionsRepository();
    const older = {
      ...buildTransaction(),
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const newer = {
      ...buildTransaction(),
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    repo.create(older);
    repo.create(newer);

    const page = repo.findPage({ offset: 0, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items.map((tx) => tx.id)).toEqual([newer.id, older.id]);
  });

  it('findEntriesByAccountId returns only the entries that touch the given account, sorted newest-first', () => {
    const repo = new InMemoryTransactionsRepository();
    const accountX = randomUuid();
    const accountY = randomUuid();
    const txOlder = '2026-01-01T00:00:00.000Z';
    const txNewer = '2026-06-01T00:00:00.000Z';

    repo.create({
      id: randomUuid(),
      createdAt: txOlder,
      entries: [
        {
          id: 'e1',
          transactionId: 'old',
          accountId: accountX,
          direction: 'debit',
          amountCents: 100,
          createdAt: txOlder,
        },
        {
          id: 'e2',
          transactionId: 'old',
          accountId: accountY,
          direction: 'credit',
          amountCents: 100,
          createdAt: txOlder,
        },
      ],
    });
    repo.create({
      id: randomUuid(),
      createdAt: txNewer,
      entries: [
        {
          id: 'e3',
          transactionId: 'new',
          accountId: accountX,
          direction: 'credit',
          amountCents: 50,
          createdAt: txNewer,
        },
        {
          id: 'e4',
          transactionId: 'new',
          accountId: accountY,
          direction: 'debit',
          amountCents: 50,
          createdAt: txNewer,
        },
      ],
    });

    const page = repo.findEntriesByAccountId(accountX, {
      offset: 0,
      limit: 10,
    });
    expect(page.total).toBe(2);
    expect(page.items.map((e) => e.id)).toEqual(['e3', 'e1']); // newest first
    expect(page.items.every((e) => e.accountId === accountX)).toBe(true);
  });

  it('findEntriesByAccountId breaks createdAt ties by id for stable ordering', () => {
    const repo = new InMemoryTransactionsRepository();
    const sameTime = '2026-01-01T00:00:00.000Z';
    repo.create({
      id: 'tx',
      createdAt: sameTime,
      entries: [
        {
          id: 'zzz',
          transactionId: 'tx',
          accountId: 'shared',
          direction: 'debit',
          amountCents: 50,
          createdAt: sameTime,
        },
        {
          id: 'aaa',
          transactionId: 'tx',
          accountId: 'shared',
          direction: 'credit',
          amountCents: 50,
          createdAt: sameTime,
        },
      ],
    });

    const page = repo.findEntriesByAccountId('shared', {
      offset: 0,
      limit: 10,
    });
    expect(page.items.map((e) => e.id)).toEqual(['aaa', 'zzz']);
  });

  it('findEntriesByAccountId returns empty for an account with no entries', () => {
    const repo = new InMemoryTransactionsRepository();
    const page = repo.findEntriesByAccountId('nobody', {
      offset: 0,
      limit: 10,
    });
    expect(page).toEqual({ items: [], total: 0, offset: 0, limit: 10 });
  });
});
