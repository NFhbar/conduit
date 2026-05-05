/**
 * Test data factories. Used by both unit specs (under `src/`) and the e2e
 * suite (under `test/`). Randomized values keep tests honest about the
 * code's generality — a test that passes only with id `'acc-a'` would fail
 * with these helpers.
 *
 * Tests that reproduce the take-home spec's example payloads should keep
 * their hard-coded ids and names; this module is for everything else.
 */
import { v4 as uuid } from 'uuid';
import { Direction } from '../domain/direction';

export function randomUuid(): string {
  return uuid();
}

/**
 * Short, readable, unique-enough identifier for tests that want to exercise
 * the "any non-empty string" id contract rather than the UUID happy path.
 */
export function randomBusinessKey(prefix = 'key'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function randomName(): string {
  return `name-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * USD amount in [minDollars, maxDollars] with two decimal places. Defaults
 * are tight enough to satisfy `@IsPositive()` and `@IsNumber({ maxDecimalPlaces: 2 })`,
 * loose enough for random arithmetic to stay nontrivial.
 */
export function randomAmount(minDollars = 0.01, maxDollars = 10_000): number {
  const minCents = Math.round(minDollars * 100);
  const maxCents = Math.round(maxDollars * 100);
  const cents =
    minCents + Math.floor(Math.random() * (maxCents - minCents + 1));
  return cents / 100;
}

export function randomDirection(): Direction {
  return Math.random() < 0.5 ? 'debit' : 'credit';
}
