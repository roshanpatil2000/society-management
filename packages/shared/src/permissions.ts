/**
 * Permission keys, format `module.action[.scope]`. This file is the source of truth:
 * the `permission` table is seeded with the same keys by migration, and a test keeps
 * the two in step. M1 has the keys the access core needs; M2 adds the full Phase 1 list.
 */
export const PERMISSIONS = {
  society: {
    view: 'society.view',
    update: 'society.update',
  },
  roles: {
    manage: 'roles.manage',
  },
  members: {
    invite: 'members.invite',
    viewAll: 'members.view.all',
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
