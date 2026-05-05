import { Direction } from '../domain/direction';
import { centsToDollars } from '../domain/money';
import { Account } from './account.entity';

export interface AccountResponse {
  id: string;
  direction: Direction;
  balance: number;
  name?: string;
}

/**
 * Wire contract for `name`: present iff the entity has one. Not emitted as
 * `null`. Done explicitly here so the omission is part of the contract,
 * not an accident of `JSON.stringify` dropping `undefined` keys.
 */
export function toAccountResponse(account: Account): AccountResponse {
  const response: AccountResponse = {
    id: account.id,
    direction: account.direction,
    balance: centsToDollars(account.balanceCents),
  };
  if (account.name !== undefined) {
    response.name = account.name;
  }
  return response;
}
