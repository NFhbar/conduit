import { Injectable } from '@nestjs/common';
import { CachedResponse } from './cached-response';
import { IdempotencyRepository } from './idempotency.repository';

@Injectable()
export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, CachedResponse>();

  findByKey(key: string): CachedResponse | undefined {
    return this.store.get(key);
  }

  /**
   * First-write-wins. The interceptor only calls `save` after a cache miss,
   * so on a single instance this branch never matters; under a future
   * Redis/Postgres backend the same contract maps to `SETNX` /
   * `INSERT … ON CONFLICT DO NOTHING`, which is exactly the atomic
   * check-and-set the interface comment promises. Aligning the in-memory
   * impl now means switching backends doesn't change the observable
   * contract.
   */
  save(key: string, response: CachedResponse): void {
    if (!this.store.has(key)) {
      this.store.set(key, response);
    }
  }
}
