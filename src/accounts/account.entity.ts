import { Direction } from '../domain/direction';

export interface Account {
  readonly id: string;
  readonly direction: Direction;
  readonly name?: string;
  readonly balanceCents: number;
}

export function withBalance(account: Account, balanceCents: number): Account {
  return { ...account, balanceCents };
}
