// Reads an opening-balances workbook: a Flats sheet (Wing, Flat No, Arrears,
// Advance) and an optional Accounts sheet (Code, Debit, Credit). Amounts are
// rupees in the file and paise (as strings, computed without floating point) in
// the result. The database (post_opening_balances) checks flats, codes and totals.
// @deno-types="../_vendor/sheetjs-0.20.3/types.d.ts"
import * as XLSX from 'xlsx';

export interface Problem {
  sheet: 'flats' | 'accounts' | 'file';
  row: number;
  field: string;
  message: string;
}

export interface FlatBalance {
  row: number;
  wing?: string;
  flat_number?: string;
  arrears?: string;
  advance?: string;
}

export interface AccountBalance {
  row: number;
  code?: string;
  debit?: string;
  credit?: string;
}

/** '₹ 12,500.50' → '1250050'; '' → null; anything else → undefined. */
export function rupeesToPaise(value: string): string | null | undefined {
  const text = value
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/,/g, '');
  if (text === '') return null;
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return undefined;
  const paise = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return paise.toString();
}

const normalize = (heading: unknown) =>
  String(heading ?? '')
    .trim()
    .toLowerCase()
    .replace(/\((₹|rs\.?|inr)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

interface SheetSpec<F extends string> {
  label: string;
  headings: Record<F, string[]>;
  required: [F, string][];
  amounts: [F, string][];
}

const FLATS: SheetSpec<'wing' | 'flat_number' | 'arrears' | 'advance'> = {
  label: 'Flats',
  headings: {
    wing: ['wing', 'building', 'block', 'tower'],
    flat_number: ['flat no', 'flat number', 'flat', 'unit', 'unit no', 'flat_number'],
    arrears: ['arrears', 'outstanding', 'dues', 'balance due', 'opening arrears'],
    advance: ['advance', 'advance paid', 'credit balance'],
  },
  required: [
    ['wing', 'Wing'],
    ['flat_number', 'Flat No'],
  ],
  amounts: [
    ['arrears', 'Arrears'],
    ['advance', 'Advance'],
  ],
};

const ACCOUNTS: SheetSpec<'code' | 'debit' | 'credit'> = {
  label: 'Accounts',
  headings: {
    code: ['code', 'account code', 'ledger code'],
    debit: ['debit', 'dr', 'debit balance'],
    credit: ['credit', 'cr', 'credit balance'],
  },
  required: [['code', 'Code']],
  amounts: [
    ['debit', 'Debit'],
    ['credit', 'Credit'],
  ],
};

const AMOUNT_HINT = 'must be an amount in rupees, like 12500 or 12,500.50';

function readSheet<F extends string>(
  sheet: XLSX.WorkSheet,
  spec: SheetSpec<F>,
  key: 'flats' | 'accounts',
  problems: Problem[],
): ({ row: number } & Partial<Record<F, string>>)[] {
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  }) as unknown[][];
  const headerIndex = grid.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (headerIndex === -1) return [];

  const header = (grid[headerIndex] ?? []).map(normalize);
  const columns = new Map<F, number>();
  for (const [field, names] of Object.entries(spec.headings) as [F, string[]][]) {
    const i = header.findIndex((h) => names.includes(h));
    if (i !== -1) columns.set(field, i);
  }
  const missing = spec.required.filter(([field]) => !columns.has(field));
  for (const [, label] of missing) {
    problems.push({
      sheet: 'file',
      row: 0,
      field: 'file',
      message: `${spec.label} sheet: missing column ${label}`,
    });
  }
  if (missing.length > 0) return [];

  const amountFields = new Map(spec.amounts);
  const rows: ({ row: number } & Partial<Record<F, string>>)[] = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const cells = grid[i] ?? [];
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;
    const row = { row: i + 1 } as { row: number } & Partial<Record<F, string>>;
    for (const [field, col] of columns) {
      const value = String(cells[col] ?? '').trim();
      const label = amountFields.get(field);
      if (label === undefined) {
        if (value !== '') row[field] = value as (typeof row)[F];
        continue;
      }
      const paise = rupeesToPaise(value);
      if (paise === undefined) {
        problems.push({ sheet: key, row: i + 1, field, message: `${label} ${AMOUNT_HINT}` });
      } else if (paise !== null) {
        row[field] = paise as (typeof row)[F];
      }
    }
    rows.push(row);
  }
  return rows;
}

export function parseOpeningWorkbook(bytes: Uint8Array): {
  flats: FlatBalance[];
  accounts: AccountBalance[];
  problems: Problem[];
} {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', dense: true });
  } catch {
    return { flats: [], accounts: [], problems: [unreadable()] };
  }
  const names = wb.SheetNames;
  const accountsName = names.find((n) => /account/i.test(n));
  const flatsName = names.find((n) => /flat/i.test(n)) ?? names.find((n) => n !== accountsName);
  const flatsSheet = flatsName ? wb.Sheets[flatsName] : undefined;
  const accountsSheet = accountsName ? wb.Sheets[accountsName] : undefined;
  if (!flatsSheet && !accountsSheet) return { flats: [], accounts: [], problems: [unreadable()] };

  const problems: Problem[] = [];
  const flats = flatsSheet ? readSheet(flatsSheet, FLATS, 'flats', problems) : [];
  const accounts = accountsSheet ? readSheet(accountsSheet, ACCOUNTS, 'accounts', problems) : [];
  if (flats.length === 0 && accounts.length === 0 && problems.length === 0) {
    problems.push({ sheet: 'file', row: 0, field: 'file', message: 'The file has no balances' });
  }
  return { flats, accounts, problems };
}

function unreadable(): Problem {
  return {
    sheet: 'file',
    row: 0,
    field: 'file',
    message:
      'This file could not be read. Upload an Excel (.xlsx) file with Flats and Accounts sheets.',
  };
}
