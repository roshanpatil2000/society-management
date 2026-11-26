/**
 * Default roles every society starts with. Committee admins can edit them or add
 * custom roles later. The `role_preset` table holds the same presets (seeded by
 * migration); the database sync test fails if the two ever differ.
 */
import {
  ALL_PERMISSION_KEYS,
  isPlatformPermission,
  PERMISSIONS as P,
  type PermissionKey,
} from './permissions';

export interface RolePreset {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

const SOCIETY_KEYS = ALL_PERMISSION_KEYS.filter((k) => !isPlatformPermission(k));

/** Every society-wide view key: what "view everything" means for Committee member and Auditor. */
export const VIEW_EVERYTHING: readonly PermissionKey[] = [
  P.society.view,
  P.flats.viewAll,
  P.members.viewAll,
  P.bills.viewAll,
  P.payments.viewAll,
  P.expenses.view,
  P.accounts.view,
  P.reports.view,
  P.dashboard.view,
  P.notices.view,
  P.complaints.viewAll,
  P.auditLog.view,
];

const moduleKeys = (...modules: (keyof typeof P)[]): PermissionKey[] =>
  modules.flatMap((m) => Object.values(P[m]) as PermissionKey[]);

const without = (keys: PermissionKey[], ...remove: PermissionKey[]): PermissionKey[] =>
  keys.filter((k) => !remove.includes(k));

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    name: 'Chairman',
    description: 'Every society permission',
    permissions: SOCIETY_KEYS,
  },
  {
    name: 'Secretary',
    description:
      'Runs the society: settings, members, notices, billing (no bill approval), complaints',
    permissions: [
      ...without(moduleKeys('society', 'roles'), P.society.updateSensitive),
      P.members.invite,
      ...moduleKeys('flats'),
      P.members.viewAll,
      P.members.viewOwn,
      P.members.manage,
      P.members.transfer,
      ...moduleKeys('notices'),
      ...without(moduleKeys('bills', 'chargeHeads'), P.bills.approve),
      ...without(moduleKeys('complaints'), P.complaints.escalationL2),
      P.dashboard.view,
      P.reports.view,
    ],
  },
  {
    name: 'Treasurer',
    description: 'Billing, payments, expenses (create and pay) and accounts',
    permissions: [
      P.society.view,
      P.notices.view,
      ...moduleKeys('bills', 'chargeHeads', 'payments'),
      P.expenses.view,
      P.expenses.create,
      P.expenses.pay,
      ...moduleKeys('accounts', 'reports', 'dashboard'),
    ],
  },
  {
    name: 'Committee member',
    description:
      'Views everything; approves expenses and bills, verifies payments, assigns complaints',
    permissions: [
      ...VIEW_EVERYTHING,
      P.expenses.approve,
      P.bills.approve,
      P.payments.verify,
      P.complaints.assign,
    ],
  },
  {
    name: 'Member',
    description: 'Flat owner: own bills and payments, complaints, notices, transparency dashboard',
    permissions: [
      P.bills.viewOwn,
      P.payments.makeOwn,
      P.members.viewOwn,
      P.complaints.create,
      P.complaints.viewOwn,
      P.dashboard.view,
      P.expenses.view,
      P.notices.view,
    ],
  },
  {
    name: 'Tenant',
    description: 'Complaints and notices; own bills only where the owner allows it',
    permissions: [
      P.complaints.create,
      P.complaints.viewOwn,
      P.dashboard.view,
      P.notices.view,
      P.bills.viewOwn,
      P.payments.makeOwn,
    ],
  },
  {
    name: 'Staff',
    description: 'Complaints assigned to them',
    permissions: [P.complaints.viewAssigned, P.complaints.updateStatus, P.notices.view],
  },
  {
    name: 'Auditor',
    description: 'Read-only access to everything, including the audit log',
    permissions: VIEW_EVERYTHING,
  },
];
