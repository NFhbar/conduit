import { Entry } from './entry.entity';

export interface Transaction {
  readonly id: string;
  readonly name?: string;
  readonly entries: ReadonlyArray<Entry>;
}
