import { CachedResponse } from './cached-response';

export const IDEMPOTENCY_REPOSITORY = 'IDEMPOTENCY_REPOSITORY';

/**
 * Storage for completed idempotent responses, keyed by the `Idempotency-Key`
 * header value.
 *
 * Synchronous on purpose, by the same atomicity argument as the other
 * repositories (see `AccountsRepository`). A real backing store (Redis,
 * Postgres) would add: a TTL on entries (Stripe uses 24h), atomic
 * check-and-set so two concurrent requests with the same key can't both
 * miss the cache and execute, and a notion of "request in progress" to
 * fence the second caller while the first is mid-flight. None of those
 * are necessary on a single-threaded in-memory v1.
 */
export interface IdempotencyRepository {
  findByKey(key: string): CachedResponse | undefined;

  /**
   * **First-write-wins.** Once a key has an entry, subsequent `save` calls
   * with the same key are no-ops. This is the canonical SQL/Redis contract
   * (`INSERT … ON CONFLICT DO NOTHING` / `SETNX`); the in-memory
   * implementation honors the same semantics so swapping stores doesn't
   * change observable behavior. The interceptor only calls `save` after a
   * cache miss, so on a single-threaded in-memory backend this branch is
   * unreachable today; the contract becomes load-bearing the moment
   * concurrent writers exist.
   */
  save(key: string, response: CachedResponse): void;
}
