import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../packages/shared/src/database.types.ts';
import { createEmailSender } from '../_shared/email.ts';
import { optionalEnv, requireEnv } from '../_shared/env.ts';
import { bearerToken, corsHeaders, errorResponse } from '../_shared/http.ts';
import { type BeginResult, handleOnboard, type OnboardDeps } from './handler.ts';

const beginResultSchema = z.object({
  society_id: z.string(),
  invites: z.array(
    z.object({ invite_id: z.string(), email: z.string(), full_name: z.string().nullable() }),
  ),
});

const admin = createClient<Database>(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

function check<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
): NonNullable<R['data']> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined) throw new Error('empty response');
  return result.data as NonNullable<R['data']>;
}

const deps: OnboardDeps = {
  async getCallerId(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },
  async isPlatformAdmin(userId) {
    const { data, error } = await admin
      .from('platform_admin')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  },
  async beginOnboard(actor, society, committee): Promise<BeginResult> {
    const data = check(
      await admin.rpc('admin_onboard_begin', {
        p_actor: actor,
        p_society:
          society as Database['public']['Functions']['admin_onboard_begin']['Args']['p_society'],
        p_committee:
          committee as Database['public']['Functions']['admin_onboard_begin']['Args']['p_committee'],
      }),
    );
    return beginResultSchema.parse(data);
  },
  async beginAddCommittee(actor, societyId, committee): Promise<BeginResult> {
    const data = check(
      await admin.rpc('admin_add_committee_begin', {
        p_actor: actor,
        p_society_id: societyId,
        p_committee:
          committee as Database['public']['Functions']['admin_add_committee_begin']['Args']['p_committee'],
      }),
    );
    return beginResultSchema.parse(data);
  },
  async findUsers(emails) {
    const rows = check(await admin.rpc('admin_find_users', { p_emails: emails }));
    return new Map(rows.map((r) => [r.email, r.user_id]));
  },
  async createUser(email, fullName) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user)
      throw new Error(`could not create account for ${email}: ${error?.message ?? 'unknown'}`);
    return data.user.id;
  },
  async deleteUser(userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
  },
  async finish(actor, societyId, accepts, finalStatus, trialEndsAt) {
    check(
      await admin.rpc('admin_onboard_finish', {
        p_actor: actor,
        p_society_id: societyId,
        p_accepts: accepts,
        ...(finalStatus ? { p_final_status: finalStatus } : {}),
        ...(trialEndsAt ? { p_trial_ends_at: trialEndsAt } : {}),
      }),
    );
  },
  async abort(actor, societyId, inviteIds) {
    check(
      await admin.rpc('admin_onboard_abort', {
        p_actor: actor,
        p_society_id: societyId,
        p_invite_ids: inviteIds,
      }),
    );
  },
  sendEmail: createEmailSender(),
  async societyName(societyId) {
    const row = check(await admin.from('society').select('name').eq('id', societyId).single());
    return row.name;
  },
  appUrl: optionalEnv('APP_URL') ?? 'http://localhost:8081',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST');
  try {
    return await handleOnboard(req, deps, bearerToken(req));
  } catch (err) {
    console.error('admin-onboard-society failed', err);
    return errorResponse(500, 'internal_error', 'Something went wrong');
  }
});
