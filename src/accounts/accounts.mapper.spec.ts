import { randomBusinessKey, randomName } from '../testing/factories';
import { Account } from './account.entity';
import { toAccountResponse } from './accounts.mapper';

describe('toAccountResponse', () => {
  it('maps balanceCents to dollar `balance` and preserves id and direction', () => {
    const account: Account = {
      id: randomBusinessKey('acc'),
      direction: 'debit',
      name: randomName(),
      openingBalanceCents: 0,
      balanceCents: 12345,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const response = toAccountResponse(account);

    expect(response.id).toBe(account.id);
    expect(response.direction).toBe('debit');
    expect(response.name).toBe(account.name);
    expect(response.balance).toBe(123.45);
  });

  it('returns balance 0 for a zero-cent account', () => {
    const account: Account = {
      id: randomBusinessKey('acc'),
      direction: 'credit',
      openingBalanceCents: 0,
      balanceCents: 0,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(toAccountResponse(account).balance).toBe(0);
  });

  it('omits `name` when the entity has none', () => {
    const account: Account = {
      id: randomBusinessKey('acc'),
      direction: 'debit',
      openingBalanceCents: 0,
      balanceCents: 0,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const response = toAccountResponse(account);
    expect(response).not.toHaveProperty('name');
  });
});
