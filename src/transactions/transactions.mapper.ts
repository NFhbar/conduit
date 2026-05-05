import { Direction } from '../domain/direction';
import { centsToDollars } from '../domain/money';
import { Entry } from './entry.entity';
import { Transaction } from './transaction.entity';

export interface EntryResponse {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: Direction;
  amount: number;
  created_at: string;
}

export interface TransactionResponse {
  id: string;
  name?: string;
  entries: EntryResponse[];
  created_at: string;
}

export function toEntryResponse(entry: Entry): EntryResponse {
  return {
    id: entry.id,
    transaction_id: entry.transactionId,
    account_id: entry.accountId,
    direction: entry.direction,
    amount: centsToDollars(entry.amountCents),
    created_at: entry.createdAt,
  };
}

/**
 * Wire contract for `name`: present iff the entity has one. Not emitted as
 * `null`. See `toAccountResponse` for the same rationale.
 */
export function toTransactionResponse(
  transaction: Transaction,
): TransactionResponse {
  const response: TransactionResponse = {
    id: transaction.id,
    entries: transaction.entries.map(toEntryResponse),
    created_at: transaction.createdAt,
  };
  if (transaction.name !== undefined) {
    response.name = transaction.name;
  }
  return response;
}
