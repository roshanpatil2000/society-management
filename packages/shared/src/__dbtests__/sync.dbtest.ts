// The database copies of the permission keys and role presets must match
// packages/shared exactly. Runs against the migrated local database.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { ALL_PERMISSION_KEYS, permissionModule } from '../permissions';
import { ROLE_PRESETS } from '../role-presets';

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  {
    max: 1,
    onnotice: () => undefined,
  },
);

afterAll(async () => {
  await sql.end();
});

describe('database matches packages/shared', () => {
  it('permission table has exactly the shared keys, with their modules', async () => {
    const rows = await sql<
      { key: string; module: string }[]
    >`select key, module from public.permission order by key`;
    expect(rows.map((r) => `${r.key}|${r.module}`)).toEqual(
      [...ALL_PERMISSION_KEYS].sort().map((k) => `${k}|${permissionModule(k)}`),
    );
  });

  it('role_preset table has exactly the shared presets, in order', async () => {
    const rows = await sql<{ name: string; permissions: string[] }[]>`
      select name, permissions from public.role_preset order by sort_order`;
    expect(rows.map((r) => ({ name: r.name, permissions: [...r.permissions].sort() }))).toEqual(
      ROLE_PRESETS.map((p) => ({ name: p.name, permissions: [...p.permissions].sort() })),
    );
  });
});
