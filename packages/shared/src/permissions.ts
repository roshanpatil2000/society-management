/**
 * Permission keys, format `module.action[.scope]`. This file is the source of truth.
 * The `permission` table holds the same keys (seeded by migration), and the
 * database sync test fails if the two ever differ.
 */
export const PERMISSIONS = {
  society: {
    view: 'society.view',
    update: 'society.update',
    updateSensitive: 'society.update_sensitive',
  },
  roles: {
    manage: 'roles.manage',
  },
  members: {
    invite: 'members.invite',
    viewAll: 'members.view.all',
    viewOwn: 'members.view.own',
    manage: 'members.manage',
    transfer: 'members.transfer',
  },
  flats: {
    viewAll: 'flats.view.all',
    manage: 'flats.manage',
  },
  bills: {
    viewOwn: 'bills.view.own',
    viewAll: 'bills.view.all',
    generate: 'bills.generate',
    approve: 'bills.approve',
    creditNote: 'bills.credit_note',
    resolveDispute: 'bills.resolve_dispute',
    send: 'bills.send',
  },
  chargeHeads: {
    manage: 'charge_heads.manage',
  },
  payments: {
    makeOwn: 'payments.make.own',
    recordOffline: 'payments.record_offline',
    viewAll: 'payments.view.all',
    verify: 'payments.verify',
    refund: 'payments.refund',
  },
  expenses: {
    view: 'expenses.view',
    create: 'expenses.create',
    approve: 'expenses.approve',
    pay: 'expenses.pay',
  },
  accounts: {
    view: 'accounts.view',
    manage: 'accounts.manage',
    openingBalance: 'accounts.opening_balance',
    closeYear: 'accounts.close_year',
  },
  reports: {
    view: 'reports.view',
  },
  dashboard: {
    view: 'dashboard.view',
  },
  notices: {
    view: 'notices.view',
    manage: 'notices.manage',
  },
  complaints: {
    create: 'complaints.create',
    viewOwn: 'complaints.view.own',
    viewAssigned: 'complaints.view.assigned',
    viewAll: 'complaints.view.all',
    assign: 'complaints.assign',
    updateStatus: 'complaints.update_status',
    escalationL1: 'complaints.escalation.l1',
    escalationL2: 'complaints.escalation.l2',
  },
  auditLog: {
    view: 'audit_log.view',
  },
  platform: {
    societiesCreate: 'platform.societies.create',
    societiesManage: 'platform.societies.manage',
  },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];

export type PermissionKey = Leaves<typeof PERMISSIONS>;

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group) as PermissionKey[],
);

/** Platform keys belong only to super-admins and are never part of a society role. */
export function isPlatformPermission(key: PermissionKey): boolean {
  return key.startsWith('platform.');
}

/** The module a key belongs to, e.g. `charge_heads` for `charge_heads.manage`. */
export function permissionModule(key: PermissionKey): string {
  return key.slice(0, key.indexOf('.'));
}
