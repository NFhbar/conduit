import { Direction } from '../domain/direction';
import { centsToDollars } from '../domain/money';
import { Account } from './account.entity';

export interface AccountResponse {
  id: string;
  direction: Direction;
  balance: number;
  name?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Wire contract for `name`: present iff the entity has one. Not emitted as
 * `null`. Done explicitly here so the omission is part of the contract,
 * not an accident of `JSON.stringify` dropping `undefined` keys.
 *
 * `openingBalanceCents` is intentionally not surfaced — it's an internal
 * field used by reconciliation, not something callers should plan against.
 * Snake-case `created_at` / `updated_at` mirror the wire convention already
 * established by the spec's `account_id` field on entries.
 */
export function toAccountResponse(account: Account): AccountResponse {
  const response: AccountResponse = {
    id: account.id,
    direction: account.direction,
    balance: centsToDollars(account.balanceCents),
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
  if (account.name !== undefined) {
    response.name = account.name;
  }
  return response;
}
