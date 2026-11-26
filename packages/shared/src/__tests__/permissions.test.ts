import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ALL_PERMISSION_KEYS, isPlatformPermission } from '../permissions';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
);

/** Every key the migrations insert into public.permission. */
function keysSeededByMigrations(): Set<string> {
  const keys = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const insert = /insert into public\.permission[\s\S]*?;/gi;
    for (const block of sql.match(insert) ?? []) {
      for (const m of block.matchAll(/\(\s*'([a-z_.0-9]+)'\s*,/g)) {
        if (m[1]) keys.add(m[1]);
      }
    }
  }
  return keys;
}

describe('permission keys', () => {
  it('match the keys seeded into the permission table', () => {
    expect([...keysSeededByMigrations()].sort()).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it('follow the module.action[.scope] format', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+(\.[a-z_0-9]+)*$/);
    }
  });

  it('marks platform keys', () => {
    expect(isPlatformPermission('platform.societies.create')).toBe(true);
    expect(isPlatformPermission('society.view')).toBe(false);
  });
});
