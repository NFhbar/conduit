import { Entry } from './entry.entity';

export interface Transaction {
  readonly id: string;
  readonly name?: string;
  readonly entries: ReadonlyArray<Entry>;
  /** ISO 8601 timestamp captured when the transaction was applied. Immutable. */
  readonly createdAt: string;
}
