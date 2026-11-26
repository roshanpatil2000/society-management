// Outbound email. Hosted projects send through Resend (RESEND_API_KEY); local
// development sends to Mailpit's HTTP API (MAILPIT_URL) so emails show up at
// http://127.0.0.1:54324. With neither configured, sending fails loudly.
import { optionalEnv } from './env.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

export function createEmailSender(fetchFn: typeof fetch = fetch): SendEmail {
  const resendKey = optionalEnv('RESEND_API_KEY');
  const mailpitUrl = optionalEnv('MAILPIT_URL');
  const from = optionalEnv('EMAIL_FROM') ?? 'Society App <no-reply@society.test>';

  if (resendKey) {
    return async (message) => {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text()}`);
    };
  }

  if (mailpitUrl) {
    const fromEmail = /<([^>]+)>/.exec(from)?.[1] ?? from;
    return async (message) => {
      const res = await fetchFn(`${mailpitUrl.replace(/\/$/, '')}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: fromEmail, Name: 'Society App' },
          To: [{ Email: message.to }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
        }),
      });
      if (!res.ok) throw new Error(`Mailpit returned ${res.status}: ${await res.text()}`);
    };
  }

  return () =>
    Promise.reject(new Error('No email provider configured (set RESEND_API_KEY or MAILPIT_URL)'));
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
