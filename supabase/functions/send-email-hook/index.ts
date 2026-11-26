import { createClient } from '@supabase/supabase-js';
import { Webhook } from 'standardwebhooks';
import { z } from 'zod';

import type { Database } from '../../../packages/shared/src/database.types.ts';
import { createEmailSender } from '../_shared/email.ts';
import { optionalEnv, requireEnv } from '../_shared/env.ts';
import { type EmailHookDeps, handleEmailHook, type HookPayload } from './handler.ts';

const payloadSchema = z.object({
  user: z.object({ email: z.string().nullish() }),
  email_data: z.object({
    token: z.string(),
    token_hash: z.string(),
    redirect_to: z.string(),
    email_action_type: z.string(),
    site_url: z.string(),
  }),
});
const checkSchema = z.object({ allowed: z.boolean(), reason: z.string().optional() });

const hookSecret = optionalEnv('SEND_EMAIL_HOOK_SECRET');
const webhook = hookSecret ? new Webhook(hookSecret.replace('v1,whsec_', '')) : null;
const admin = createClient<Database>(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

const deps: EmailHookDeps = {
  verify(body, headers): HookPayload {
    if (!webhook) throw new Error('SEND_EMAIL_HOOK_SECRET is not set');
    return payloadSchema.parse(webhook.verify(body, headers));
  },
  async check(email, action) {
    const { data, error } = await admin.rpc('email_hook_check', {
      p_email: email,
      p_action: action,
    });
    if (error) throw new Error(error.message);
    return checkSchema.parse(data);
  },
  sendEmail: createEmailSender(),
};

Deno.serve((req) => {
  if (!webhook) {
    console.error('send-email-hook: SEND_EMAIL_HOOK_SECRET is not set');
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: 'Email sending is not configured' } }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
  return handleEmailHook(req, deps);
});
