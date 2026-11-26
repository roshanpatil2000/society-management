# Secrets and environment checklist

Values never go in the repo. This file lists **names only** and where each one lives.

## GitHub (repository settings)

| Name | Kind | Used by | Needed from |
| --- | --- | --- | --- |
| `STAGING_PROJECT_REF` | Variable | CI `deploy-staging` job (the job is skipped while this is empty) | M0 |
| `SUPABASE_ACCESS_TOKEN` | Secret (environment `staging`) | CI: `supabase link`, `functions deploy` | M0 |
| `STAGING_DB_PASSWORD` | Secret (environment `staging`) | CI: `supabase db push --remote` | M0 |
| `EXPO_TOKEN` | Secret | EAS builds and updates from CI (later) | M10 |

## Supabase Edge Function secrets (`supabase secrets set`, per project)

| Name | Used by | Needed from |
| --- | --- | --- |
| `RESEND_API_KEY` | `send-email-hook`, `admin-onboard-society` (welcome emails), later `notify` | M1 |
| `SEND_EMAIL_HOOK_SECRET` | `send-email-hook` (verifies calls from Supabase Auth; format `v1,whsec_...`) | M1 |
| `EMAIL_FROM` | Sender, e.g. `Society App <no-reply@your-domain>` | M1 |
| `APP_URL` | Link in welcome emails | M1 |
| `TURNSTILE_SECRET_KEY` | Auth CAPTCHA | M1 |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Auth Google provider (dashboard / config) | M1 |
| `EXPO_ACCESS_TOKEN` | `notify` (push) | M5 |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | `notify` | M5 |
| `SENTRY_DSN` | Edge Functions error reporting | M10 |
| Razorpay keys | Per society, stored in Supabase Vault, not as function secrets | M6 (optional) |
| SMS provider key | Only if SMS is ever switched on (see PLAN.md, Optional SMS) | — |

`service_role` is provided to Edge Functions automatically. It is never put in the app or in GitHub.

## App (`apps/mobile`, public values only)

| Name | Notes |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Per environment |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The anon (publishable) key only |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | M1 |
| `EXPO_PUBLIC_SENTRY_DSN` | M10 |

Local values go in `apps/mobile/.env.local` (git-ignored); copy from `apps/mobile/.env.example`.

Local Edge Function settings go in `supabase/functions/.env` (git-ignored); copy from `supabase/functions/.env.example`. Locally, email goes to Mailpit instead of Resend.

Dashboard-only Auth settings (hooks, templates, CAPTCHA, Google) are listed in [AUTH-SETUP.md](AUTH-SETUP.md).
