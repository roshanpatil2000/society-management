// Supabase Auth Send Email hook (hosted projects). Auth calls this instead of
// sending its own emails. We verify the webhook signature, refuse unknown
// addresses and enforce per-address and platform-wide limits (email_hook_check),
// then send the code email through the configured provider.
import { escapeHtml, type EmailMessage } from '../_shared/email.ts';

export interface HookPayload {
  user: { email?: string | null };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

export interface HookCheck {
  allowed: boolean;
  reason?: string;
}

export interface EmailHookDeps {
  /** Verifies the Standard Webhooks signature and returns the payload, or throws. */
  verify(body: string, headers: Record<string, string>): HookPayload;
  check(email: string, action: string): Promise<HookCheck>;
  sendEmail(message: EmailMessage): Promise<void>;
}

// Auth hook error format: Auth shows `message` to the client.
function hookError(httpCode: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: httpCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CODE_ACTIONS = new Set(['signup', 'magiclink', 'email', 'invite', 'reauthentication']);

export function renderEmail(to: string, data: HookPayload['email_data']): EmailMessage | null {
  if (!CODE_ACTIONS.has(data.email_action_type)) return null;
  const code = escapeHtml(data.token);
  return {
    to,
    subject: 'Your Society App sign-in code',
    text: `Your Society App sign-in code is ${data.token}. It expires in 10 minutes and works once.`,
    html:
      `<h2>Your sign-in code</h2><p>Enter this code in the Society App to sign in:</p>` +
      `<p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p>` +
      `<p>The code expires in 10 minutes and works once. If you didn't try to sign in, ignore this email.</p>`,
  };
}

export async function handleEmailHook(req: Request, deps: EmailHookDeps): Promise<Response> {
  if (req.method !== 'POST') return hookError(405, 'Method not allowed');

  const body = await req.text();
  let payload: HookPayload;
  try {
    payload = deps.verify(body, Object.fromEntries(req.headers));
  } catch {
    return hookError(401, 'Invalid webhook signature');
  }

  const email = payload.user.email?.toLowerCase();
  if (!email) return hookError(400, 'No email address');

  const message = renderEmail(email, payload.email_data);
  if (!message) {
    // Account changes we don't use (password, email change): send nothing.
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const verdict = await deps.check(email, payload.email_data.email_action_type);
  if (!verdict.allowed) {
    return verdict.reason === 'unknown_address'
      ? hookError(403, "This email isn't registered with any society. Ask your committee.")
      : hookError(429, 'Too many codes requested. Wait a while and try again.');
  }

  try {
    await deps.sendEmail(message);
  } catch (err) {
    console.error('send-email-hook: provider failed', err);
    return hookError(502, 'Could not send the email. Try again shortly.');
  }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}
