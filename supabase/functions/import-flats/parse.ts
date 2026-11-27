// Reads the first sheet of an Excel (.xlsx/.xls) or CSV file into flat rows,
// matching common heading names. Validation of the values happens in the
// database (import_flats), which reports problems by spreadsheet row number.
import * as XLSX from 'xlsx';

export interface FlatRow {
  row: number;
  wing?: string;
  flat_number?: string;
  floor?: string;
  area_sqft?: string;
  flat_type?: string;
  parking_slot?: string;
  owner_name?: string;
  owner_email?: string;
}

type Field = Exclude<keyof FlatRow, 'row'>;

const HEADINGS: Record<Field, string[]> = {
  wing: ['wing', 'building', 'block', 'tower'],
  flat_number: ['flat no', 'flat number', 'flat', 'unit', 'unit no', 'flat_number'],
  floor: ['floor'],
  area_sqft: [
    'area (sq ft)',
    'area sq ft',
    'area sqft',
    'area',
    'carpet area',
    'sq ft',
    'area_sqft',
  ],
  flat_type: ['type', 'flat type', 'bhk', 'flat_type'],
  parking_slot: ['parking', 'parking slot', 'parking_slot'],
  owner_name: ['owner name', 'owner', 'owner_name'],
  owner_email: ['owner email', 'email', 'owner_email'],
};

const REQUIRED: [Field, string][] = [
  ['wing', 'Wing'],
  ['flat_number', 'Flat No'],
];

const normalize = (heading: unknown) =>
  String(heading ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export function parseFlatSheet(bytes: Uint8Array): { rows: FlatRow[]; problems: string[] } {
  let grid: unknown[][];
  try {
    const wb = XLSX.read(bytes, { type: 'array', dense: true });
    const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
    if (!sheet) return { rows: [], problems: ['The sheet is empty'] };
    grid = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    }) as unknown[][];
  } catch {
    return {
      rows: [],
      problems: ['This file could not be read. Upload an Excel (.xlsx) or CSV file.'],
    };
  }

  const headerIndex = grid.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (headerIndex === -1) return { rows: [], problems: ['The sheet is empty'] };

  const header = (grid[headerIndex] ?? []).map(normalize);
  const columns = new Map<Field, number>();
  for (const [field, names] of Object.entries(HEADINGS) as [Field, string[]][]) {
    const i = header.findIndex((h) => names.includes(h));
    if (i !== -1) columns.set(field, i);
  }
  const problems = REQUIRED.filter(([field]) => !columns.has(field)).map(
    ([, label]) => `Missing column: ${label}`,
  );
  if (problems.length > 0) return { rows: [], problems };

  const rows: FlatRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const cells = grid[i] ?? [];
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;
    const row: FlatRow = { row: i + 1 };
    for (const [field, col] of columns) {
      const value = String(cells[col] ?? '').trim();
      if (value !== '') row[field] = value;
    }
    rows.push(row);
  }
  return { rows, problems: [] };
}
