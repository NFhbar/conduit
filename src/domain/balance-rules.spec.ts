import { isBalanced } from './balance-rules';

describe('isBalanced', () => {
  it('returns true for matched single debit and credit', () => {
    expect(
      isBalanced([
        { direction: 'debit', amountCents: 10000 },
        { direction: 'credit', amountCents: 10000 },
      ]),
    ).toBe(true);
  });

  it('returns false when debits and credits do not match', () => {
    expect(
      isBalanced([
        { direction: 'debit', amountCents: 10000 },
        { direction: 'credit', amountCents: 9999 },
      ]),
    ).toBe(false);
  });

  it('balances multi-entry splits (one debit, multiple credits)', () => {
    expect(
      isBalanced([
        { direction: 'debit', amountCents: 10000 },
        { direction: 'credit', amountCents: 6000 },
        { direction: 'credit', amountCents: 4000 },
      ]),
    ).toBe(true);
  });

  it('returns false for an all-debit set', () => {
    expect(
      isBalanced([
        { direction: 'debit', amountCents: 5000 },
        { direction: 'debit', amountCents: 5000 },
      ]),
    ).toBe(false);
  });

  it('returns true for an empty list (0 === 0) — callers guard for emptiness separately', () => {
    expect(isBalanced([])).toBe(true);
  });
});
