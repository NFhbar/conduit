import { Direction } from '../domain/direction';

export interface Entry {
  readonly id: string;
  readonly accountId: string;
  readonly direction: Direction;
  readonly amountCents: number;
}
