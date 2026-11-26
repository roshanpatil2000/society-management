// Decides which screen a person should see, from what we know about their session.
// Every screen redirect in the app goes through this one function.

/** Bump when the consent notice text changes; people accept the new version once. */
export const CURRENT_CONSENT_VERSION = 1;

export interface GateInput {
  /** The stored session has been restored (or found missing). */
  authReady: boolean;
  signedIn: boolean;
  /** Society picked by code before login (tenant discovery), if any. */
  discoveredSocietyId: string | null;
  /** Society last used, if any. */
  activeSocietyId: string | null;
  isPlatformAdmin: boolean;
  /** Society ids the user is an active member of. */
  memberships: readonly string[];
  /** Society ids with a pending invite for the user's email. */
  pendingInviteSocietyIds: readonly string[];
  /** Consent version the user accepted, or null. */
  consentVersion: number | null;
  /** Memberships, invites and profile have loaded. */
  dataReady: boolean;
}

export type Gate =
  | { screen: 'loading' }
  | { screen: 'discovery' }
  | { screen: 'login' }
  | { screen: 'picker' }
  | { screen: 'admin' }
  | { screen: 'invite'; societyId: string }
  | { screen: 'not-member'; societyId: string }
  | { screen: 'consent'; societyId: string }
  | { screen: 'app'; societyId: string };

export function resolveGate(input: GateInput): Gate {
  if (!input.authReady) return { screen: 'loading' };
  if (!input.signedIn)
    return input.discoveredSocietyId ? { screen: 'login' } : { screen: 'discovery' };
  if (!input.dataReady) return { screen: 'loading' };

  const open = (societyId: string): Gate =>
    (input.consentVersion ?? 0) >= CURRENT_CONSENT_VERSION
      ? { screen: 'app', societyId }
      : { screen: 'consent', societyId };

  const target = input.discoveredSocietyId;
  if (target) {
    if (input.memberships.includes(target)) return open(target);
    if (input.pendingInviteSocietyIds.includes(target))
      return { screen: 'invite', societyId: target };
    return { screen: 'not-member', societyId: target };
  }

  if (input.activeSocietyId && input.memberships.includes(input.activeSocietyId)) {
    return open(input.activeSocietyId);
  }
  if (input.memberships.length === 1 && input.memberships[0]) return open(input.memberships[0]);
  if (input.memberships.length > 1) return { screen: 'picker' };
  if (input.pendingInviteSocietyIds[0])
    return { screen: 'invite', societyId: input.pendingInviteSocietyIds[0] };
  if (input.isPlatformAdmin) return { screen: 'admin' };
  return { screen: 'discovery' };
}
