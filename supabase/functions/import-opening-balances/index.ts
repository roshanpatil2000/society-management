import { createClient } from '@supabase/supabase-js';

import type { Database, Json } from '../../../packages/shared/src/database.types.ts';
import { requireEnv } from '../_shared/env.ts';
import { bearerToken, corsHeaders, errorResponse } from '../_shared/http.ts';
import { handleOpening, type OpeningDeps } from './handler.ts';

const url = requireEnv('SUPABASE_URL');
const anonKey = requireEnv('SUPABASE_ANON_KEY');

const deps: OpeningDeps = {
  async callOpening(token, societyId, asOf, flats, accounts, dryRun) {
    // The caller's own session: RLS and permissions are theirs, not the service role's.
    const client = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.rpc('post_opening_balances', {
      p_society_id: societyId,
      p_as_of: asOf,
      p_flats: flats as unknown as Json,
      p_accounts: accounts as unknown as Json,
      p_dry_run: dryRun,
    });
    if (error) throw error;
    return data;
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST');
  try {
    return await handleOpening(req, deps, bearerToken(req));
  } catch (err) {
    console.error('import-opening-balances failed', err);
    return errorResponse(500, 'internal_error', 'Something went wrong');
  }
});
