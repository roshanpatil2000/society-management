import { assertEquals } from '@std/assert';
import * as XLSX from 'xlsx';

import { parseOpeningWorkbook, rupeesToPaise } from './parse.ts';

function workbook(sheets: Record<string, unknown[][]>, type: 'xlsx' | 'csv' = 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: type }));
}

Deno.test('converts rupee text to paise exactly, without floating point', () => {
  assertEquals(rupeesToPaise('12500'), '1250000');
  assertEquals(rupeesToPaise('₹ 12,500.5'), '1250050');
  assertEquals(rupeesToPaise('Rs. 0.07'), '7');
  assertEquals(rupeesToPaise(''), null);
  for (const bad of ['-500', '12.345', '1e5', 'abc', '(500)'])
    assertEquals(rupeesToPaise(bad), undefined);
});

Deno.test('reads the Flats and Accounts sheets with spreadsheet row numbers', () => {
  const out = parseOpeningWorkbook(
    workbook({
      Flats: [
        ['Wing', 'Flat No', 'Arrears (₹)', 'Advance (₹)'],
        ['A', 101, 12500, ''],
        [],
        ['A', '102', '', '3,000'],
      ],
      Accounts: [
        ['Code', 'Account', 'Debit', 'Credit'],
        ['1020', 'Bank', 80000, ''],
        [3900, 'Surplus / Deficit', '', '89500'],
      ],
    }),
  );
  assertEquals(out.problems, []);
  assertEquals(out.flats, [
    { row: 2, wing: 'A', flat_number: '101', arrears: '1250000' },
    { row: 4, wing: 'A', flat_number: '102', advance: '300000' },
  ]);
  assertEquals(out.accounts, [
    { row: 2, code: '1020', debit: '8000000' },
    { row: 3, code: '3900', credit: '8950000' },
  ]);
});

Deno.test('reports bad amounts by sheet, row and column', () => {
  const out = parseOpeningWorkbook(
    workbook({
      Flats: [
        ['Wing', 'Flat No', 'Arrears'],
        ['A', '101', '-50'],
      ],
      Accounts: [
        ['Code', 'Debit', 'Credit'],
        ['1010', '12.345', ''],
      ],
    }),
  );
  assertEquals(out.problems, [
    {
      sheet: 'flats',
      row: 2,
      field: 'arrears',
      message: 'Arrears must be an amount in rupees, like 12500 or 12,500.50',
    },
    {
      sheet: 'accounts',
      row: 2,
      field: 'debit',
      message: 'Debit must be an amount in rupees, like 12500 or 12,500.50',
    },
  ]);
});

Deno.test('a single-sheet file or CSV is read as the Flats sheet', () => {
  const out = parseOpeningWorkbook(
    workbook(
      {
        Sheet1: [
          ['Wing', 'Flat No', 'Arrears'],
          ['B', '201', '500'],
        ],
      },
      'csv',
    ),
  );
  assertEquals(out.problems, []);
  assertEquals(out.flats, [{ row: 2, wing: 'B', flat_number: '201', arrears: '50000' }]);
  assertEquals(out.accounts, []);
});

Deno.test('reports missing columns and unreadable files', () => {
  const missing = parseOpeningWorkbook(
    workbook({
      Flats: [
        ['Wing', 'Arrears'],
        ['A', '1'],
      ],
      Accounts: [
        ['Name', 'Debit'],
        ['Bank', '1'],
      ],
    }),
  );
  assertEquals(missing.problems, [
    { sheet: 'file', row: 0, field: 'file', message: 'Flats sheet: missing column Flat No' },
    { sheet: 'file', row: 0, field: 'file', message: 'Accounts sheet: missing column Code' },
  ]);
  const garbage = parseOpeningWorkbook(new Uint8Array([1, 2, 3, 4, 5]));
  assertEquals(garbage.flats.length + garbage.accounts.length, 0);
  assertEquals(garbage.problems.length > 0, true);
});
