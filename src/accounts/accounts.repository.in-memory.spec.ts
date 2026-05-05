import {
  DuplicateIdError,
  EntityNotFoundError,
  StaleVersionError,
} from '../common/repository-errors';
import { randomBusinessKey } from '../testing/factories';
import { Account } from './account.entity';
import { InMemoryAccountsRepository } from './accounts.repository.in-memory';

/**
 * Direct repository tests. The service-level specs cover the happy paths
 * indirectly; these specs cover the typed-error throw paths that services'
 * pre-checks make unreachable in normal flow but that future async backends
 * could trigger via races.
 */
describe('InMemoryAccountsRepository', () => {
  function buildAccount(): Account {
    return {
      id: randomBusinessKey('acc'),
      direction: 'debit',
      openingBalanceCents: 0,
      balanceCents: 0,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('throws DuplicateIdError on create when id already exists', () => {
    const repo = new InMemoryAccountsRepository();
    const account = buildAccount();
    repo.create(account);
    expect(() => repo.create(account)).toThrow(DuplicateIdError);
  });

  it('throws EntityNotFoundError on update when id is unknown', () => {
    const repo = new InMemoryAccountsRepository();
    expect(() => repo.update(buildAccount())).toThrow(EntityNotFoundError);
  });

  it('returns undefined from findById when id is unknown', () => {
    const repo = new InMemoryAccountsRepository();
    expect(repo.findById(randomBusinessKey('missing'))).toBeUndefined();
  });

  it('replaces the stored account on update and bumps the version by one', () => {
    const repo = new InMemoryAccountsRepository();
    const account = buildAccount();
    repo.create(account);
    expect(repo.findById(account.id)?.version).toBe(0);

    repo.update({ ...account, balanceCents: 5000 });
    const after = repo.findById(account.id);
    expect(after?.balanceCents).toBe(5000);
    expect(after?.version).toBe(1);
  });

  it('throws StaleVersionError when the caller-observed version is behind the stored version', () => {
    // Two readers see version 0. First commit succeeds and bumps to 1.
    // The second commit, still holding a version-0 view, must fail rather
    // than silently overwrite — the canonical lost-update race.
    const repo = new InMemoryAccountsRepository();
    const account = buildAccount();
    repo.create(account);

    const readerA = repo.findById(account.id)!;
    const readerB = repo.findById(account.id)!;

    repo.update({ ...readerA, balanceCents: 1000 });

    expect(() => repo.update({ ...readerB, balanceCents: 2000 })).toThrow(
      StaleVersionError,
    );
    // Reader A's commit is preserved; reader B's clobber is rejected.
    expect(repo.findById(account.id)?.balanceCents).toBe(1000);
    expect(repo.findById(account.id)?.version).toBe(1);
  });

  it('allows sequential updates by re-reading the bumped version after each commit', () => {
    const repo = new InMemoryAccountsRepository();
    const account = buildAccount();
    repo.create(account);

    for (let i = 1; i <= 3; i++) {
      const current = repo.findById(account.id)!;
      repo.update({ ...current, balanceCents: i * 100 });
    }

    const after = repo.findById(account.id);
    expect(after?.version).toBe(3);
    expect(after?.balanceCents).toBe(300);
  });

  it('returns every stored account from findAll', () => {
    const repo = new InMemoryAccountsRepository();
    expect(repo.findAll()).toEqual([]);

    const a = buildAccount();
    const b = buildAccount();
    repo.create(a);
    repo.create(b);

    const all = repo.findAll();
    expect(all).toHaveLength(2);
    expect(all.map((acc) => acc.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('paginates findPage in newest-first order with correct total', () => {
    const repo = new InMemoryAccountsRepository();
    const a = { ...buildAccount(), createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...buildAccount(), createdAt: '2026-02-01T00:00:00.000Z' };
    const c = { ...buildAccount(), createdAt: '2026-03-01T00:00:00.000Z' };
    repo.create(a);
    repo.create(b);
    repo.create(c);

    const firstPage = repo.findPage({ offset: 0, limit: 2 });
    expect(firstPage.total).toBe(3);
    expect(firstPage.offset).toBe(0);
    expect(firstPage.limit).toBe(2);
    // Newest first: c (Mar), then b (Feb).
    expect(firstPage.items.map((acc) => acc.id)).toEqual([c.id, b.id]);

    const secondPage = repo.findPage({ offset: 2, limit: 2 });
    expect(secondPage.total).toBe(3);
    expect(secondPage.items.map((acc) => acc.id)).toEqual([a.id]);
  });

  it('returns an empty page with total 0 when the store is empty', () => {
    const repo = new InMemoryAccountsRepository();
    const page = repo.findPage({ offset: 0, limit: 20 });
    expect(page).toEqual({ items: [], total: 0, offset: 0, limit: 20 });
  });

  it('returns empty items but the correct total when offset exceeds total', () => {
    const repo = new InMemoryAccountsRepository();
    repo.create(buildAccount());
    repo.create(buildAccount());
    const page = repo.findPage({ offset: 100, limit: 20 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(2);
    expect(page.offset).toBe(100);
    expect(page.limit).toBe(20);
  });

  it('breaks createdAt ties by id for stable ordering', () => {
    const repo = new InMemoryAccountsRepository();
    const sameTime = '2026-01-01T00:00:00.000Z';
    const a = { ...buildAccount(), id: 'aaa', createdAt: sameTime };
    const b = { ...buildAccount(), id: 'bbb', createdAt: sameTime };
    repo.create(b); // insertion order opposite to id order
    repo.create(a);
    expect(
      repo.findPage({ offset: 0, limit: 10 }).items.map((x) => x.id),
    ).toEqual(['aaa', 'bbb']);
  });
});
