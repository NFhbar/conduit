import { applyEntry, directionSign } from './direction';

describe('applyEntry', () => {
  // Mirrors the four-row table from the take-home spec.
  it.each([
    {
      account: 'debit' as const,
      entry: 'debit' as const,
      start: 0,
      expected: 100,
    },
    {
      account: 'credit' as const,
      entry: 'credit' as const,
      start: 0,
      expected: 100,
    },
    {
      account: 'debit' as const,
      entry: 'credit' as const,
      start: 100,
      expected: 0,
    },
    {
      account: 'credit' as const,
      entry: 'debit' as const,
      start: 100,
      expected: 0,
    },
  ])(
    'account=$account entry=$entry start=$start -> $expected',
    ({ account, entry, start, expected }) => {
      const result = applyEntry(start, account, {
        direction: entry,
        amountCents: 100,
      });
      expect(result).toBe(expected);
    },
  );

  it('does not mutate the input balance', () => {
    const start = 500;
    applyEntry(start, 'debit', { direction: 'debit', amountCents: 100 });
    expect(start).toBe(500);
  });

  it('produces negative balances when withdrawals exceed deposits', () => {
    const result = applyEntry(50, 'debit', {
      direction: 'credit',
      amountCents: 100,
    });
    expect(result).toBe(-50);
  });
});

describe('directionSign', () => {
  it('returns +1 for debit accounts', () => {
    expect(directionSign('debit')).toBe(1);
  });

  it('returns -1 for credit accounts', () => {
    expect(directionSign('credit')).toBe(-1);
  });
});
