import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter, useSegments } from 'expo-router';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';

import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/stores/session';

import { type Access, getPermissions, loadAccess } from './api';
import { type Gate, resolveGate } from './gate';
import { redirectFor } from './gate-routes';

interface GateValue {
  gate: Gate;
  session: Session | null;
  access: Access | undefined;
}

const GateContext = createContext<GateValue | null>(null);

export function useGateContext(): GateValue {
  const value = useContext(GateContext);
  if (!value) throw new Error('useGateContext must be used inside <AuthGate>');
  return value;
}

function useAuthSession(): { ready: boolean; session: Session | null } {
  const [state, setState] = useState<{ ready: boolean; session: Session | null }>({
    ready: false,
    session: null,
  });
  const queryClient = useQueryClient();
  const signedOut = useSessionStore((s) => s.signedOut);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ ready: true, session: data.session });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ ready: true, session });
      if (event === 'SIGNED_OUT') {
        signedOut();
        queryClient.clear();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient, signedOut]);

  return state;
}

/** Restores the session, works out which screen the person should be on, and redirects. */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { ready, session } = useAuthSession();
  const discovered = useSessionStore((s) => s.discovered);
  const activeSocietyId = useSessionStore((s) => s.activeSocietyId);
  const setActiveSociety = useSessionStore((s) => s.setActiveSociety);
  const setPermissions = useSessionStore((s) => s.setPermissions);
  const userId = session?.user.id;

  const access = useQuery({
    queryKey: ['access', userId],
    queryFn: () => loadAccess(userId ?? ''),
    enabled: Boolean(userId),
  });

  const gate = useMemo(
    () =>
      resolveGate({
        authReady: ready,
        signedIn: Boolean(session),
        discoveredSocietyId: discovered?.society_id ?? null,
        activeSocietyId,
        isPlatformAdmin: access.data?.isPlatformAdmin ?? false,
        memberships: access.data?.memberships.map((m) => m.society_id) ?? [],
        pendingInviteSocietyIds: access.data?.invites.map((i) => i.society_id) ?? [],
        consentVersion: access.data?.consentVersion ?? null,
        dataReady: access.isSuccess,
      }),
    [ready, session, discovered, activeSocietyId, access.data, access.isSuccess],
  );

  const societyId = gate.screen === 'app' ? gate.societyId : null;
  useEffect(() => {
    if (societyId && societyId !== activeSocietyId) setActiveSociety(societyId);
  }, [societyId, activeSocietyId, setActiveSociety]);

  const permissions = useQuery({
    queryKey: ['permissions', societyId],
    queryFn: () => getPermissions(societyId ?? ''),
    enabled: Boolean(societyId) && societyId === activeSocietyId,
  });
  useEffect(() => {
    if (permissions.data) setPermissions(permissions.data);
  }, [permissions.data, setPermissions]);

  const target = redirectFor(gate, segments);
  useEffect(() => {
    if (target) router.replace(target as Href);
  }, [target, router]);

  const waiting = gate.screen === 'loading' || (gate.screen === 'app' && !permissions.isSuccess);
  const theme = useTheme();

  return (
    <GateContext.Provider value={{ gate, session, access: access.data }}>
      {children}
      {waiting ? (
        <View style={[styles.overlay, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" />
        </View>
      ) : null}
    </GateContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
