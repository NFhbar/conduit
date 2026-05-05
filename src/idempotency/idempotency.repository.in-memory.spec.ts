import { randomBusinessKey } from '../testing/factories';
import { IDEMPOTENCY_REPOSITORY } from './idempotency.repository';
import { InMemoryIdempotencyRepository } from './idempotency.repository.in-memory';

describe('InMemoryIdempotencyRepository', () => {
  it('exports a DI token alongside the implementation', () => {
    expect(IDEMPOTENCY_REPOSITORY).toBe('IDEMPOTENCY_REPOSITORY');
  });

  it('returns undefined for an unknown key', () => {
    const repo = new InMemoryIdempotencyRepository();
    expect(repo.findByKey(randomBusinessKey('idem'))).toBeUndefined();
  });

  it('round-trips a saved entry', () => {
    const repo = new InMemoryIdempotencyRepository();
    const key = randomBusinessKey('idem');
    const cached = {
      bodyFingerprint: 'abc',
      statusCode: 201,
      body: { ok: true },
    };
    repo.save(key, cached);
    expect(repo.findByKey(key)).toEqual(cached);
  });

  it('is first-write-wins: a second save with the same key is a no-op', () => {
    // Aligns with the contract a Redis/Postgres backend would provide via
    // `SETNX` / `INSERT … ON CONFLICT DO NOTHING`. Switching the in-memory
    // impl to "last-wins" would silently change observable behavior the day
    // we swap stores.
    const repo = new InMemoryIdempotencyRepository();
    const key = randomBusinessKey('idem');
    const original = { bodyFingerprint: 'a', statusCode: 200, body: 1 };
    repo.save(key, original);
    repo.save(key, { bodyFingerprint: 'b', statusCode: 400, body: 'err' });
    expect(repo.findByKey(key)).toEqual(original);
  });
});
