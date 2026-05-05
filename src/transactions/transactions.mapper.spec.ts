import {
  randomBusinessKey,
  randomName,
  randomUuid,
} from '../testing/factories';
import { Entry } from './entry.entity';
import { Transaction } from './transaction.entity';
import { toEntryResponse, toTransactionResponse } from './transactions.mapper';

describe('toEntryResponse', () => {
  it('maps internal camelCase fields to wire snake_case and converts cents to dollars', () => {
    const entry: Entry = {
      id: randomUuid(),
      accountId: randomBusinessKey('acc'),
      direction: 'debit',
      amountCents: 7500,
    };

    const response = toEntryResponse(entry);

    expect(response).toEqual({
      id: entry.id,
      account_id: entry.accountId,
      direction: 'debit',
      amount: 75,
    });
  });
});

describe('toTransactionResponse', () => {
  function buildEntries(): Entry[] {
    return [
      {
        id: randomUuid(),
        accountId: randomBusinessKey('a'),
        direction: 'debit',
        amountCents: 1000,
      },
      {
        id: randomUuid(),
        accountId: randomBusinessKey('b'),
        direction: 'credit',
        amountCents: 1000,
      },
    ];
  }

  it('includes `name` when present and maps every entry through the entry mapper', () => {
    const transaction: Transaction = {
      id: randomUuid(),
      name: randomName(),
      entries: buildEntries(),
    };

    const response = toTransactionResponse(transaction);

    expect(response.id).toBe(transaction.id);
    expect(response.name).toBe(transaction.name);
    expect(response.entries).toHaveLength(2);
    for (let i = 0; i < transaction.entries.length; i++) {
      expect(response.entries[i]).toEqual(
        toEntryResponse(transaction.entries[i]),
      );
    }
  });

  it('omits `name` when the entity has none', () => {
    const transaction: Transaction = {
      id: randomUuid(),
      entries: buildEntries(),
    };
    const response = toTransactionResponse(transaction);
    expect(response).not.toHaveProperty('name');
  });
});
