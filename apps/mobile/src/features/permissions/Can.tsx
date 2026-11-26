import type { ReactNode } from 'react';

import type { PermissionKey } from '@society/shared';

import { useSessionStore } from '@/stores/session';

import { can } from './permissions';

/** Convenience only: the database enforces every permission. */
export function usePermission(key: PermissionKey): boolean {
  return useSessionStore((s) => can(s.permissions, key));
}

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? children : fallback;
}
