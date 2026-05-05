import { Direction } from '../domain/direction';

export interface Entry {
  readonly id: string;
  /** Back-reference to the parent transaction. Lets an entry name its parent without a join. */
  readonly transactionId: string;
  readonly accountId: string;
  readonly direction: Direction;
  readonly amountCents: number;
  /** ISO 8601 timestamp; mirrors the parent transaction's `createdAt`. */
  readonly createdAt: string;
}
