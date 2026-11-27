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

/**
 * Parses rupees as people type them ('25000', '₹ 25,000.50') into paise, from the
 * digits, with no float arithmetic. '' gives null; anything else invalid gives undefined.
 */
export function parseRupees(text: string): Paise | null | undefined {
  const cleaned = text
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/,/g, '');
  if (cleaned === '') return null;
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return undefined;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : undefined;
}
