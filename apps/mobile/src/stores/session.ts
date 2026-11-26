import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { appStorage } from '@/lib/app-storage';

/** What discover_society returned for the society the person picked before login. */
export interface DiscoveredSociety {
  society_id: string;
  slug: string;
  name: string;
  city: string | null;
  logo_url: string | null;
  login_methods: string[];
}

interface SessionState {
  discovered: DiscoveredSociety | null;
  activeSocietyId: string | null;
  permissions: string[];
  chooseSociety(society: DiscoveredSociety): void;
  forgetSociety(): void;
  setActiveSociety(societyId: string | null): void;
  setPermissions(permissions: string[]): void;
  signedOut(): void;
  reset(): void;
}

const initial = { discovered: null, activeSocietyId: null, permissions: [] };

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      ...initial,
      chooseSociety: (society) =>
        set({ discovered: society, activeSocietyId: society.society_id, permissions: [] }),
      forgetSociety: () => set({ discovered: null, activeSocietyId: null, permissions: [] }),
      setActiveSociety: (societyId) => set({ activeSocietyId: societyId, permissions: [] }),
      setPermissions: (permissions) => set({ permissions }),
      signedOut: () => set({ activeSocietyId: null, permissions: [] }),
      reset: () => set(initial),
    }),
    {
      name: 'society-session',
      storage: createJSONStorage(() => appStorage),
      // Permissions are always re-read from the server; only remember the choices.
      partialize: (s) => ({ discovered: s.discovered, activeSocietyId: s.activeSocietyId }),
    },
  ),
);
