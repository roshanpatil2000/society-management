// Super-admin calls. The database and the Edge Function check platform-admin
// rights on every call; the console only hides itself from others.
import type { OnboardSocietyRequest } from '@society/shared';

import { supabase } from '@/lib/supabase';

export interface AdminSociety {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  trial_ends_at: string | null;
  quotas: Record<string, number>;
}

function fail(error: { message: string } | null): void {
  if (error) throw error;
}

const columns = 'id, name, slug, status, plan, trial_ends_at, quotas';

function toSociety(row: { quotas: unknown } & Omit<AdminSociety, 'quotas'>): AdminSociety {
  return { ...row, quotas: (row.quotas ?? {}) as Record<string, number> };
}

export async function listSocieties(): Promise<AdminSociety[]> {
  const { data, error } = await supabase
    .from('society')
    .select(columns)
    .order('created_at', { ascending: false });
  fail(error);
  return (data ?? []).map(toSociety);
}

export async function getSociety(id: string): Promise<AdminSociety> {
  const { data, error } = await supabase.from('society').select(columns).eq('id', id).single();
  fail(error);
  if (!data) throw new Error('society_not_found');
  return toSociety(data);
}

/** Calls admin-onboard-society; turns its error body into a { message } the app can translate. */
export async function onboardSociety(
  request: OnboardSocietyRequest,
): Promise<{ society_id: string }> {
  const { data, error } = await supabase.functions.invoke<{ society_id: string }>(
    'admin-onboard-society',
    {
      body: request,
    },
  );
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    const message = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw { message: message?.message ?? message?.code ?? error.message };
  }
  if (!data) throw new Error('empty response');
  return data;
}

export async function setStatus(
  id: string,
  status: 'trial' | 'active' | 'suspended' | 'closed',
): Promise<void> {
  const { error } = await supabase.rpc('platform_set_society_status', {
    p_society_id: id,
    p_status: status,
  });
  fail(error);
}

export async function setQuotas(id: string, quotas: Record<string, number>): Promise<void> {
  const { error } = await supabase.rpc('platform_set_quotas', {
    p_society_id: id,
    p_quotas: quotas,
  });
  fail(error);
}

export async function setSlug(id: string, slug: string): Promise<string> {
  const { data, error } = await supabase.rpc('platform_set_society_slug', {
    p_society_id: id,
    p_slug: slug,
  });
  fail(error);
  return data ?? slug;
}
