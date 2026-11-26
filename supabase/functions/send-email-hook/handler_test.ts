import { assertEquals } from '@std/assert';

import type { EmailMessage } from '../_shared/email.ts';
import {
  type EmailHookDeps,
  handleEmailHook,
  type HookCheck,
  type HookPayload,
} from './handler.ts';

const payload: HookPayload = {
  user: { email: 'Member@Example.com' },
  email_data: {
    token: '123456',
    token_hash: 'hash',
    redirect_to: 'http://localhost:8081',
    email_action_type: 'magiclink',
    site_url: 'http://localhost:8081',
  },
};

function deps(
  check: HookCheck,
  sent: EmailMessage[],
  opts: { badSignature?: boolean; failSend?: boolean } = {},
) {
  const checked: string[] = [];
  const d: EmailHookDeps = {
    verify: (body) => {
      if (opts.badSignature) throw new Error('bad signature');
      return JSON.parse(body) as HookPayload;
    },
    check: (email) => {
      checked.push(email);
      return Promise.resolve(check);
    },
    sendEmail: (m) => {
      if (opts.failSend) return Promise.reject(new Error('down'));
      sent.push(m);
      return Promise.resolve();
    },
  };
  return { d, checked };
}

const post = (p: unknown) =>
  new Request('http://localhost/send-email-hook', { method: 'POST', body: JSON.stringify(p) });

Deno.test('sends the code to a known address within limits', async () => {
  const sent: EmailMessage[] = [];
  const { d, checked } = deps({ allowed: true }, sent);
  const res = await handleEmailHook(post(payload), d);
  assertEquals(res.status, 200);
  assertEquals(checked, ['member@example.com']);
  assertEquals(sent.length, 1);
  assertEquals(sent[0]?.text.includes('123456'), true);
});

Deno.test('refuses a bad signature with 401 and sends nothing', async () => {
  const sent: EmailMessage[] = [];
  const res = await handleEmailHook(
    post(payload),
    deps({ allowed: true }, sent, { badSignature: true }).d,
  );
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
});

Deno.test('refuses an unknown address with 403', async () => {
  const sent: EmailMessage[] = [];
  const res = await handleEmailHook(
    post(payload),
    deps({ allowed: false, reason: 'unknown_address' }, sent).d,
  );
  assertEquals(res.status, 403);
  assertEquals(sent.length, 0);
});

Deno.test('refuses an address over its limit with 429', async () => {
  const sent: EmailMessage[] = [];
  const res = await handleEmailHook(
    post(payload),
    deps({ allowed: false, reason: 'address_hourly_limit' }, sent).d,
  );
  assertEquals(res.status, 429);
  const out = await res.json();
  assertEquals(out.error.http_code, 429);
  assertEquals(sent.length, 0);
});

Deno.test('sends nothing and succeeds for actions the app does not use', async () => {
  const sent: EmailMessage[] = [];
  const { d, checked } = deps({ allowed: true }, sent);
  const res = await handleEmailHook(
    post({
      ...payload,
      email_data: { ...payload.email_data, email_action_type: 'password_changed_notification' },
    }),
    d,
  );
  assertEquals(res.status, 200);
  assertEquals(checked.length + sent.length, 0);
});

Deno.test('returns 502 when the provider fails', async () => {
  const res = await handleEmailHook(
    post(payload),
    deps({ allowed: true }, [], { failSend: true }).d,
  );
  assertEquals(res.status, 502);
});
