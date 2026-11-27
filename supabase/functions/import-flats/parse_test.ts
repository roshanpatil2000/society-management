import { assertEquals } from '@std/assert';
import * as XLSX from 'xlsx';

import { parseFlatSheet } from './parse.ts';

function workbook(rows: unknown[][], type: 'xlsx' | 'csv' = 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Flats');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: type }));
}

Deno.test('reads flats with friendly headings and keeps spreadsheet row numbers', () => {
  const { rows, problems } = parseFlatSheet(
    workbook([
      ['Wing', 'Flat No', 'Floor', 'Area (sq ft)', 'Type', 'Owner Name', 'Owner Email'],
      ['A', 101, 1, 650, '2BHK', 'Ravi', 'Ravi@Example.com'],
      [],
      ['B', '201', 2, '720.5', '', '', ''],
    ]),
  );
  assertEquals(problems, []);
  assertEquals(rows, [
    {
      row: 2,
      wing: 'A',
      flat_number: '101',
      floor: '1',
      area_sqft: '650',
      flat_type: '2BHK',
      owner_name: 'Ravi',
      owner_email: 'Ravi@Example.com',
    },
    { row: 4, wing: 'B', flat_number: '201', floor: '2', area_sqft: '720.5' },
  ]);
});

Deno.test('accepts other common heading names and CSV files', () => {
  const { rows, problems } = parseFlatSheet(
    workbook(
      [
        ['Building', 'Unit', 'Carpet Area', 'Email'],
        ['Tower 1', '12', '500', 'x@y.com'],
      ],
      'csv',
    ),
  );
  assertEquals(problems, []);
  assertEquals(rows, [
    { row: 2, wing: 'Tower 1', flat_number: '12', area_sqft: '500', owner_email: 'x@y.com' },
  ]);
});

Deno.test('reports missing required columns', () => {
  const { rows, problems } = parseFlatSheet(
    workbook([
      ['Floor', 'Area'],
      ['1', '500'],
    ]),
  );
  assertEquals(rows, []);
  assertEquals(problems, ['Missing column: Wing', 'Missing column: Flat No']);
});

Deno.test('reports an empty or unreadable file', () => {
  assertEquals(parseFlatSheet(workbook([])).problems, ['The sheet is empty']);
  // Random bytes read as CSV text; what matters is a problem and no rows, not a crash.
  const garbage = parseFlatSheet(new Uint8Array([1, 2, 3, 4]));
  assertEquals(garbage.rows, []);
  assertEquals(garbage.problems.length > 0, true);
});
