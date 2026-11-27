// Dates for accounts screens, in Asia/Kolkata (the financial year runs April-March).

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today in India as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return IST_DATE.format(now);
}

/** The last 31 March on or before yesterday: the close of the previous financial year. */
export function defaultOpeningDate(now: Date = new Date()): string {
  const [year = '1970', month = '01'] = todayIst(now).split('-');
  const y = Number(year);
  return `${Number(month) >= 4 ? y : y - 1}-03-31`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 0) - 1, d ?? 0));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}

/** '2026-03-31' → '31 Mar 2026'. */
export function formatDate(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
