// Everything the sign-in flow asks of the backend. Screens call these, never
// supabase directly, so tests can replace this module.
import { supabase } from '@/lib/supabase';
import type { DiscoveredSociety } from '@/stores/session';

export interface MembershipSummary {
  society_id: string;
  society_name: string;
  role_names: string[];
}

export interface PendingInvite {
  society_id: string;
  society_name: string;
  role_names: string[];
  token: string;
}

export interface Access {
  userId: string;
  email: string | null;
  fullName: string | null;
  consentVersion: number | null;
  isPlatformAdmin: boolean;
  memberships: MembershipSummary[];
  invites: PendingInvite[];
}

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw error;
}

export async function discoverSociety(slug: string): Promise<DiscoveredSociety | null> {
  const { data, error } = await supabase.rpc('discover_society', { p_code: slug });
  fail(error);
  const row = data?.[0];
  return row ? { ...row, login_methods: row.login_methods ?? [] } : null;
}

export async function sendCode(email: string, captchaToken?: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Accounts are only created for invited emails; the Before User Created hook decides.
    options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) },
  });
  fail(error);
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  fail(error);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  fail(error);
}

export async function loadAccess(userId: string): Promise<Access> {
  const [profile, memberships, invites, admin] = await Promise.all([
    supabase
      .from('profiles')
      .select('email, full_name, consent_version')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('my_memberships').select('society_id, society_name, role_names'),
    supabase.rpc('my_pending_invites'),
    supabase.from('platform_admin').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  for (const r of [profile, memberships, invites, admin]) fail(r.error);
  return {
    userId,
    email: profile.data?.email ?? null,
    fullName: profile.data?.full_name ?? null,
    consentVersion: profile.data?.consent_version ?? null,
    isPlatformAdmin: admin.data !== null,
    memberships: (memberships.data ?? []).flatMap((m) =>
      m.society_id && m.society_name
        ? [
            {
              society_id: m.society_id,
              society_name: m.society_name,
              role_names: m.role_names ?? [],
            },
          ]
        : [],
    ),
    invites: (invites.data ?? []).map((i) => ({
      society_id: i.society_id,
      society_name: i.society_name,
      role_names: i.role_names ?? [],
      token: i.token,
    })),
  };
}

export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
  fail(error);
  return data ?? '';
}

export async function acceptConsent(version: number): Promise<void> {
  const { error } = await supabase.rpc('accept_consent', { p_version: version });
  fail(error);
}

export async function getPermissions(societyId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_my_permissions', { p_society_id: societyId });
  fail(error);
  return data ?? [];
}
