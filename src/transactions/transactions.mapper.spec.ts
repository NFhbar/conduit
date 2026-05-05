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
      transactionId: randomUuid(),
      accountId: randomBusinessKey('acc'),
      direction: 'debit',
      amountCents: 7500,
      createdAt: '2026-05-05T10:00:00.000Z',
    };

    const response = toEntryResponse(entry);

    expect(response).toEqual({
      id: entry.id,
      account_id: entry.accountId,
      transaction_id: entry.transactionId,
      direction: 'debit',
      amount: 75,
      created_at: entry.createdAt,
    });
  });
});

describe('toTransactionResponse', () => {
  function buildEntries(transactionId: string, createdAt: string): Entry[] {
    return [
      {
        id: randomUuid(),
        transactionId,
        accountId: randomBusinessKey('a'),
        direction: 'debit',
        amountCents: 1000,
        createdAt,
      },
      {
        id: randomUuid(),
        transactionId,
        accountId: randomBusinessKey('b'),
        direction: 'credit',
        amountCents: 1000,
        createdAt,
      },
    ];
  }

  it('includes `name` and `created_at` when present and maps every entry through the entry mapper', () => {
    const txId = randomUuid();
    const createdAt = '2026-05-05T10:00:00.000Z';
    const transaction: Transaction = {
      id: txId,
      name: randomName(),
      entries: buildEntries(txId, createdAt),
      createdAt,
    };

    const response = toTransactionResponse(transaction);

    expect(response.id).toBe(transaction.id);
    expect(response.name).toBe(transaction.name);
    expect(response.created_at).toBe(createdAt);
    expect(response.entries).toHaveLength(2);
    for (let i = 0; i < transaction.entries.length; i++) {
      expect(response.entries[i]).toEqual(
        toEntryResponse(transaction.entries[i]),
      );
    }
  });

  it('omits `name` when the entity has none', () => {
    const txId = randomUuid();
    const createdAt = '2026-05-05T10:00:00.000Z';
    const transaction: Transaction = {
      id: txId,
      entries: buildEntries(txId, createdAt),
      createdAt,
    };
    const response = toTransactionResponse(transaction);
    expect(response).not.toHaveProperty('name');
  });
});
