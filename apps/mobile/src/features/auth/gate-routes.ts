import type { Gate } from './gate';

/**
 * Given the gate decision and the current route segments (from useSegments),
 * returns where to redirect, or null when the current route is fine.
 */
export function redirectFor(gate: Gate, segments: readonly string[]): string | null {
  const group = segments[0];
  const page = segments[1];

  switch (gate.screen) {
    case 'loading':
      return null;
    case 'discovery':
    case 'login':
      return group === '(auth)' || group === 's'
        ? null
        : gate.screen === 'login'
          ? '/login'
          : '/discover';
    case 'picker':
      return (group === '(gate)' && page === 'picker') || isLookup(group, page) ? null : '/picker';
    case 'invite':
    case 'not-member':
    case 'consent':
      return group === '(gate)' && page === gate.screen ? null : `/${gate.screen}`;
    case 'admin':
      return group === 'admin' ? null : '/admin';
    case 'app':
      return group === '(app)' || group === 'admin' || isLookup(group, page) ? null : '/';
  }
}

/** Looking up another society by code is allowed when already signed in. */
function isLookup(group: string | undefined, page: string | undefined): boolean {
  return (group === '(auth)' && (page === 'discover' || page === 'scan')) || group === 's';
}
