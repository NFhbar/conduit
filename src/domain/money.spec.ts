import { centsToDollars, dollarsToCents } from './money';

describe('dollarsToCents', () => {
  it.each([
    { input: 0, expected: 0 },
    { input: 1, expected: 100 },
    { input: 100, expected: 10000 },
    { input: 100.5, expected: 10050 },
    { input: 100.55, expected: 10055 },
    { input: 0.01, expected: 1 },
    { input: 0.1 + 0.2, expected: 30 },
  ])('converts $input dollars to $expected cents', ({ input, expected }) => {
    expect(dollarsToCents(input)).toBe(expected);
  });

  it('rejects amounts with more than two decimal places', () => {
    expect(() => dollarsToCents(100.555)).toThrow(/two decimal places/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => dollarsToCents(NaN)).toThrow();
    expect(() => dollarsToCents(Infinity)).toThrow();
    expect(() => dollarsToCents(-Infinity)).toThrow();
  });

  it('round-trips with centsToDollars', () => {
    for (const value of [0, 1, 100, 100.5, 100.55, 9999.99]) {
      expect(centsToDollars(dollarsToCents(value))).toBe(value);
    }
  });
});

describe('centsToDollars', () => {
  it.each([
    { input: 0, expected: 0 },
    { input: 100, expected: 1 },
    { input: 10000, expected: 100 },
    { input: 10050, expected: 100.5 },
    { input: 10055, expected: 100.55 },
  ])('converts $input cents to $expected dollars', ({ input, expected }) => {
    expect(centsToDollars(input)).toBe(expected);
  });
});
