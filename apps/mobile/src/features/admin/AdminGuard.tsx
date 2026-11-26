import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

/** Hides the console from everyone but platform admins. The server checks again on every call. */
export function AdminGuard({
  isPlatformAdmin,
  children,
}: {
  isPlatformAdmin: boolean;
  children: ReactNode;
}) {
  return isPlatformAdmin ? children : <Redirect href="/" />;
}
