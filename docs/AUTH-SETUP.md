# Auth setup for hosted projects (staging, production)

Locally, `supabase/config.jsonc` configures Auth. Hosted projects ignore that file for Auth, so set these once per project in the Supabase dashboard. CI pushes migrations and Edge Functions but not these settings.

## 1. Bootstrap the super-admin

Nobody can sign up without an invite, including you. Allow your own email once, in **SQL Editor**:

```sql
insert into private.platform_admin_email (email) values ('you@example.com');
```

Then sign in with that email (email code or Google). Your first sign-in creates the account and makes it a platform admin.

## 2. Block self-registration (Before User Created hook)

**Authentication → Hooks → Before User Created** → Postgres function → schema `private`, function `hook_before_user_created` → Enable.

Check: requesting a code for an email that has no invite should fail with "This email isn't registered with any society."

## 3. Email sign-in with a 6-digit code

**Authentication → Sign In / Providers → Email**:

- Email provider: on. Confirm email: off (accounts are created only for invited emails).
- Email OTP expiration: `600` seconds. OTP length: `6`.

**Authentication → Emails → Templates**: paste `supabase/templates/otp_code.html` into both **Magic Link** and **Confirm signup**, subject "Your Society App sign-in code". (Skip this step if you enable the Send Email hook in step 4; the hook renders its own email.)

## 4. Sending email (Send Email hook + Resend)

1. Create a Resend account, verify your sending domain (SPF, DKIM, DMARC), and create an API key.
2. **Authentication → Hooks → Send Email** → HTTPS → URL `https://<project-ref>.supabase.co/functions/v1/send-email-hook` → generate a secret → Enable.
3. Set the function secrets (values from steps 1 and 2):

   ```bash
   pnpm exec supabase secrets set --project-ref <project-ref> RESEND_API_KEY=... SEND_EMAIL_HOOK_SECRET='v1,whsec_...' EMAIL_FROM='Society App <no-reply@your-domain>' APP_URL=https://<app-url>
   ```

The hook refuses unknown addresses and enforces the limits in `public.platform_config` (per address: 5 an hour, 20 a day; platform-wide daily cap).

## 5. Rate limits and CAPTCHA

- **Authentication → Rate Limits**: keep email sends and sign-in attempts low (for example 30 sign-ins per 5 minutes per IP).
- **Authentication → Attack Protection → CAPTCHA**: Cloudflare Turnstile, with the secret key. The app passes the Turnstile token on the email-code screen (M3).

## 6. Google sign-in

1. Google Cloud Console → OAuth client (Web) → authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Authentication → Sign In / Providers → Google**: client ID and secret.
3. **Authentication → URL Configuration**: site URL and redirect URLs for the app (`societyapp://`, the web URL).

Google sign-in is still gated by the Before User Created hook: a Google account whose email has no invite cannot create an account. A Google account with the same verified email as an existing user is linked to that user automatically.
