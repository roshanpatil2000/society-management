import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSION_KEYS,
  isPlatformPermission,
  PERMISSIONS,
  type PermissionKey,
} from '../permissions';
import { ROLE_PRESETS, VIEW_EVERYTHING } from '../role-presets';

const preset = (name: string): readonly PermissionKey[] => {
  const found = ROLE_PRESETS.find((p) => p.name === name);
  if (!found) throw new Error(`no preset ${name}`);
  return found.permissions;
};

const PHASE_1_KEYS = [
  'society.view',
  'society.update',
  'society.update_sensitive',
  'roles.manage',
  'members.invite',
  'flats.view.all',
  'flats.manage',
  'members.view.all',
  'members.manage',
  'members.view.own',
  'members.transfer',
  'bills.view.own',
  'bills.view.all',
  'bills.generate',
  'bills.approve',
  'bills.credit_note',
  'bills.resolve_dispute',
  'bills.send',
  'charge_heads.manage',
  'payments.make.own',
  'payments.record_offline',
  'payments.view.all',
  'payments.verify',
  'payments.refund',
  'expenses.view',
  'expenses.create',
  'expenses.approve',
  'expenses.pay',
  'accounts.view',
  'accounts.manage',
  'accounts.opening_balance',
  'accounts.close_year',
  'reports.view',
  'dashboard.view',
  'notices.view',
  'notices.manage',
  'complaints.create',
  'complaints.view.own',
  'complaints.view.assigned',
  'complaints.view.all',
  'complaints.assign',
  'complaints.update_status',
  'complaints.escalation.l1',
  'complaints.escalation.l2',
  'audit_log.view',
  'platform.societies.create',
  'platform.societies.manage',
];

describe('permission keys', () => {
  it('cover exactly the Phase 1 list from the plan', () => {
    expect([...ALL_PERMISSION_KEYS].sort()).toEqual([...PHASE_1_KEYS].sort());
  });

  it('are unique and follow module.action[.scope]', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
    for (const key of ALL_PERMISSION_KEYS) expect(key).toMatch(/^[a-z_]+\.[a-z_]+(\.[a-z_0-9]+)*$/);
  });

  it('marks platform keys', () => {
    expect(isPlatformPermission(PERMISSIONS.platform.societiesCreate)).toBe(true);
    expect(isPlatformPermission(PERMISSIONS.society.view)).toBe(false);
  });
});

describe('role presets', () => {
  it('are the eight Phase 1 roles, in order', () => {
    expect(ROLE_PRESETS.map((p) => p.name)).toEqual([
      'Chairman',
      'Secretary',
      'Treasurer',
      'Committee member',
      'Member',
      'Tenant',
      'Staff',
      'Auditor',
    ]);
  });

  it('use only known keys, never platform keys, without duplicates', () => {
    for (const p of ROLE_PRESETS) {
      for (const key of p.permissions) {
        expect(ALL_PERMISSION_KEYS).toContain(key);
        expect(isPlatformPermission(key)).toBe(false);
      }
      expect(new Set(p.permissions).size).toBe(p.permissions.length);
    }
  });

  it('Chairman has every society key', () => {
    expect([...preset('Chairman')].sort()).toEqual(
      ALL_PERMISSION_KEYS.filter((k) => !isPlatformPermission(k)).sort(),
    );
  });

  it('Secretary runs the society but cannot approve bills, change sensitive settings or escalate to l2', () => {
    const s = preset('Secretary');
    for (const k of [
      'society.update',
      'roles.manage',
      'members.invite',
      'flats.manage',
      'members.manage',
      'members.transfer',
      'notices.manage',
      'bills.generate',
      'bills.send',
      'charge_heads.manage',
      'complaints.view.all',
      'complaints.assign',
      'complaints.escalation.l1',
      'dashboard.view',
      'reports.view',
    ] as const) {
      expect(s).toContain(k);
    }
    for (const k of [
      'bills.approve',
      'society.update_sensitive',
      'complaints.escalation.l2',
      'payments.verify',
      'expenses.approve',
    ] as const) {
      expect(s).not.toContain(k);
    }
  });

  it('Treasurer handles billing, payments, expenses and accounts, but not expense approval', () => {
    const t = preset('Treasurer');
    for (const k of [
      'bills.generate',
      'bills.approve',
      'payments.record_offline',
      'payments.verify',
      'payments.refund',
      'expenses.create',
      'expenses.pay',
      'accounts.manage',
      'accounts.opening_balance',
      'accounts.close_year',
      'reports.view',
      'dashboard.view',
    ] as const) {
      expect(t).toContain(k);
    }
    for (const k of ['expenses.approve', 'roles.manage', 'society.update_sensitive'] as const) {
      expect(t).not.toContain(k);
    }
  });

  it('Committee member views everything and holds the checker keys only', () => {
    expect([...preset('Committee member')].sort()).toEqual(
      [
        ...VIEW_EVERYTHING,
        'expenses.approve',
        'bills.approve',
        'payments.verify',
        'complaints.assign',
      ].sort(),
    );
  });

  it('Member, Tenant and Staff match the plan exactly', () => {
    expect([...preset('Member')].sort()).toEqual([
      'bills.view.own',
      'complaints.create',
      'complaints.view.own',
      'dashboard.view',
      'expenses.view',
      'members.view.own',
      'notices.view',
      'payments.make.own',
    ]);
    expect([...preset('Tenant')].sort()).toEqual([
      'bills.view.own',
      'complaints.create',
      'complaints.view.own',
      'dashboard.view',
      'notices.view',
      'payments.make.own',
    ]);
    expect([...preset('Staff')].sort()).toEqual([
      'complaints.update_status',
      'complaints.view.assigned',
      'notices.view',
    ]);
  });

  it('Auditor can view everything and write nothing', () => {
    expect([...preset('Auditor')].sort()).toEqual([...VIEW_EVERYTHING].sort());
  });

  it('view-everything is every society-wide view key', () => {
    expect([...VIEW_EVERYTHING].sort()).toEqual([
      'accounts.view',
      'audit_log.view',
      'bills.view.all',
      'complaints.view.all',
      'dashboard.view',
      'expenses.view',
      'flats.view.all',
      'members.view.all',
      'notices.view',
      'payments.view.all',
      'reports.view',
      'society.view',
    ]);
  });
});
