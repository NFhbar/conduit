import {
  DuplicateIdError,
  EntityNotFoundError,
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
      balanceCents: 0,
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

  it('replaces the stored account on update', () => {
    const repo = new InMemoryAccountsRepository();
    const account = buildAccount();
    repo.create(account);
    repo.update({ ...account, balanceCents: 5000 });
    expect(repo.findById(account.id)?.balanceCents).toBe(5000);
  });
});
