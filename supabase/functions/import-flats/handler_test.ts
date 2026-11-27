import { assertEquals } from '@std/assert';
import * as XLSX from 'xlsx';

import { handleImport, type ImportDeps } from './handler.ts';

const SOCIETY = '6f1c2d8e-1b2a-4c3d-9e8f-0a1b2c3d4e5f';

function fileBase64(rows: unknown[][]): string {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Flats');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

const req = (body: unknown) =>
  new Request('http://localhost/import-flats', { method: 'POST', body: JSON.stringify(body) });

function deps(
  result: unknown = {
    ok: true,
    wings_created: 0,
    flats_created: 1,
    invites_created: 0,
    errors: [],
  },
) {
  const calls: { token: string; societyId: string; rows: unknown[]; dryRun: boolean }[] = [];
  const d: ImportDeps = {
    callImport: (token, societyId, rows, dryRun) => {
      calls.push({ token, societyId, rows, dryRun });
      return Promise.resolve(result);
    },
  };
  return { d, calls };
}

Deno.test('requires a signed-in caller', async () => {
  const { d } = deps();
  assertEquals((await handleImport(req({}), d, null)).status, 401);
});

Deno.test(
  "parses the file and passes the rows to the database with the caller's own session",
  async () => {
    const { d, calls } = deps();
    const res = await handleImport(
      req({
        society_id: SOCIETY,
        file_base64: fileBase64([
          ['Wing', 'Flat No'],
          ['A', '101'],
        ]),
        dry_run: true,
      }),
      d,
      'user-jwt',
    );
    assertEquals(res.status, 200);
    assertEquals(calls, [
      {
        token: 'user-jwt',
        societyId: SOCIETY,
        rows: [{ row: 2, wing: 'A', flat_number: '101' }],
        dryRun: true,
      },
    ]);
    assertEquals((await res.json()).flats_created, 1);
  },
);

Deno.test('returns file problems without calling the database', async () => {
  const { d, calls } = deps();
  const res = await handleImport(
    req({ society_id: SOCIETY, file_base64: fileBase64([['Floor'], ['1']]) }),
    d,
    'user-jwt',
  );
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.ok, false);
  assertEquals(out.errors[0], { row: 0, field: 'file', message: 'Missing column: Wing' });
  assertEquals(calls.length, 0);
});

Deno.test('refuses a bad request or a file over 2 MB', async () => {
  const { d } = deps();
  assertEquals(
    (await handleImport(req({ society_id: 'nope', file_base64: 'x' }), d, 'jwt')).status,
    400,
  );
  const big = 'A'.repeat(3 * 1024 * 1024);
  assertEquals(
    (await handleImport(req({ society_id: SOCIETY, file_base64: big }), d, 'jwt')).status,
    413,
  );
});

Deno.test('passes database permission errors back as 403', async () => {
  const d: ImportDeps = {
    callImport: () => Promise.reject({ message: 'permission_denied: flats.manage', code: '42501' }),
  };
  const res = await handleImport(
    req({
      society_id: SOCIETY,
      file_base64: fileBase64([
        ['Wing', 'Flat No'],
        ['A', '1'],
      ]),
    }),
    d,
    'jwt',
  );
  assertEquals(res.status, 403);
});
