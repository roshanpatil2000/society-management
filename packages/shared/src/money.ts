/**
 * Money is always an integer number of paise (bigint in Postgres).
 * Never use floats for money. Format as rupees only for display.
 */
export type Paise = number;

export function assertPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Money must be a whole number of paise, got ${value}`);
  }
  return value;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats paise as Indian rupees with Indian digit grouping, e.g. 12345600 -> "₹1,23,456.00". */
export function formatPaise(paise: Paise): string {
  assertPaise(paise);
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const rest = abs % 100;
  // Build the decimal from integers so no float arithmetic touches the amount.
  const formatted = inrFormatter.format(Number(`${rupees}.${String(rest).padStart(2, '0')}`));
  return paise < 0 ? `-${formatted}` : formatted;
}
