import { assertEquals } from '@std/assert';
import * as XLSX from 'xlsx';

import { handleOpening, type OpeningDeps } from './handler.ts';

const SOCIETY = '6f1c2d8e-1b2a-4c3d-9e8f-0a1b2c3d4e5f';

function fileBase64(sheets: Record<string, unknown[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

const GOOD = {
  Flats: [
    ['Wing', 'Flat No', 'Arrears'],
    ['A', '101', '100'],
  ],
  Accounts: [
    ['Code', 'Credit'],
    ['3900', '100'],
  ],
};

const req = (body: unknown) =>
  new Request('http://localhost/import-opening-balances', {
    method: 'POST',
    body: JSON.stringify(body),
  });

function deps(
  result: unknown = {
    ok: true,
    entry_id: 'e1',
    flats: 1,
    total_debit: 10000,
    total_credit: 10000,
    errors: [],
  },
) {
  const calls: unknown[] = [];
  const d: OpeningDeps = {
    callOpening: (token, societyId, asOf, flats, accounts, dryRun) => {
      calls.push({ token, societyId, asOf, flats, accounts, dryRun });
      return Promise.resolve(result);
    },
  };
  return { d, calls };
}

Deno.test('requires a signed-in caller', async () => {
  assertEquals((await handleOpening(req({}), deps().d, null)).status, 401);
});

Deno.test("passes the parsed sheets to the database with the caller's session", async () => {
  const { d, calls } = deps();
  const res = await handleOpening(
    req({ society_id: SOCIETY, as_of: '2026-03-31', file_base64: fileBase64(GOOD), dry_run: true }),
    d,
    'user-jwt',
  );
  assertEquals(res.status, 200);
  assertEquals(calls, [
    {
      token: 'user-jwt',
      societyId: SOCIETY,
      asOf: '2026-03-31',
      flats: [{ row: 2, wing: 'A', flat_number: '101', arrears: '10000' }],
      accounts: [{ row: 2, code: '3900', credit: '10000' }],
      dryRun: true,
    },
  ]);
  assertEquals((await res.json()).ok, true);
});

Deno.test('returns file problems without calling the database', async () => {
  const { d, calls } = deps();
  const res = await handleOpening(
    req({
      society_id: SOCIETY,
      as_of: '2026-03-31',
      file_base64: fileBase64({ Flats: [['Wing'], ['A']] }),
    }),
    d,
    'jwt',
  );
  const out = await res.json();
  assertEquals(out.ok, false);
  assertEquals(out.errors[0].field, 'file');
  assertEquals(calls.length, 0);
});

Deno.test('refuses a bad date, a bad request or a file over 2 MB', async () => {
  const { d } = deps();
  const file = fileBase64(GOOD);
  assertEquals(
    (
      await handleOpening(
        req({ society_id: SOCIETY, as_of: '31/03/2026', file_base64: file }),
        d,
        'jwt',
      )
    ).status,
    400,
  );
  assertEquals(
    (
      await handleOpening(
        req({ society_id: 'nope', as_of: '2026-03-31', file_base64: file }),
        d,
        'jwt',
      )
    ).status,
    400,
  );
  const big = 'A'.repeat(3 * 1024 * 1024);
  assertEquals(
    (
      await handleOpening(
        req({ society_id: SOCIETY, as_of: '2026-03-31', file_base64: big }),
        d,
        'jwt',
      )
    ).status,
    413,
  );
});

Deno.test('maps database refusals to 403 and 409', async () => {
  const body = { society_id: SOCIETY, as_of: '2026-03-31', file_base64: fileBase64(GOOD) };
  const denied: OpeningDeps = {
    callOpening: () =>
      Promise.reject({ message: 'permission_denied: accounts.opening_balance', code: '42501' }),
  };
  assertEquals((await handleOpening(req(body), denied, 'jwt')).status, 403);
  const posted: OpeningDeps = {
    callOpening: () =>
      Promise.reject({
        message: 'opening_already_posted: opening balances were already posted',
        code: 'P0001',
      }),
  };
  const res = await handleOpening(req(body), posted, 'jwt');
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, 'opening_already_posted');
});
