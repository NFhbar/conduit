/**
 * Converts a USD dollar amount (as a JSON number) into integer cents.
 * Rejects non-finite values and amounts with more than two decimal places.
 *
 * Internal storage uses cents to keep arithmetic exact; floating-point
 * dollars break as soon as fractional amounts arrive (e.g. 0.1 + 0.2).
 */
export function dollarsToCents(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`amount ${value} is not a finite number`);
  }
  const cents = Math.round(value * 100);
  if (Math.abs(value - cents / 100) > 1e-9) {
    throw new Error(`amount ${value} has more than two decimal places`);
  }
  return cents;
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}
