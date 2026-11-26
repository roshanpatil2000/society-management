# Society App — Technical Build Plan

## Summary

Build one Expo (React Native) app for members, committee and staff, on Supabase as the full backend: Postgres with row-level security (RLS) isolates each society and enforces role permissions, so there is no separate API server.

- **One app, all roles:** the same app runs on Android, iOS and web. After login the user picks a society (if they belong to more than one), and the app shows only the tabs and actions their permissions allow.
- **Multi-tenant:** many societies share one Supabase project. Every tenant-owned row carries `society_id`, and RLS policies stop any user from reading or writing another society's rows.
- **Where logic lives:** simple reads and writes go straight from the app to tables (guarded by RLS); money operations run as Postgres functions (RPC) in one transaction; PDFs, imports, notifications and the optional Razorpay integration run as Supabase Edge Functions.
- **Scope of this plan:** Phase 1 (MVP) modules: roles and permissions, members and flats (including transfers and opening balances), billing, payments, accounting and expenses, notices and notifications, transparency dashboard, complaints. Unresolved choices are listed under Open decisions at the end.
- **How to use it:** this file is `docs/PLAN.md`. Build one milestone at a time from the Build order section.

## Tech stack and repo structure

A TypeScript monorepo holds the Expo app, the Supabase project (SQL migrations, Edge Functions, tests) and a shared package for permission keys and validation schemas.

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| App | Expo (React Native) + Expo Router, TypeScript; web from the same app via react-native-web |
| App data | supabase-js with generated TypeScript types; TanStack Query for caching; Zustand for session (active society, permissions) |
| App UI | React Native Paper or Tamagui; react-hook-form + zod |
| Database | Supabase Postgres, RLS on every table, schema managed by SQL migrations (Supabase CLI) |
| Business logic | Postgres functions called via RPC (`supabase.rpc(...)`) for billing, payments, approvals, journal entries |
| Server code | Supabase Edge Functions (Deno, TypeScript) for PDFs, bank statement parsing, Excel import, notifications, optional Razorpay |
| Auth | Supabase Auth: email OTP + Sign in with Google; SMS optional and off by default (see Optional SMS); custom SMTP (Resend or Amazon SES) via the Send Email hook; Before User Created hook blocks self-registration |
| Files | Supabase Storage, private buckets, RLS policies per society |
| Scheduled jobs | Supabase Cron (pg_cron) calling SQL functions or Edge Functions |
| Realtime | Supabase Realtime for complaint status and notice updates |
| Payments | Default: direct UPI to the society's current account (UPI link or QR, no gateway fee); member submits UTR + receipt, a committee member verifies. Optional per society: Razorpay with webhooks |
| Notifications | Expo push and in-app inbox (always), email, WhatsApp Business templates (opt-in, capped by society quota); SMS optional, off by default |
| Testing | pgTAP via `supabase test db` (RLS and functions), Deno tests for Edge Functions, Jest + React Native Testing Library for the app |
| Local dev | Supabase CLI (`supabase start` runs Postgres, Auth, Storage, Studio locally in Docker) |

```
society-app/
  apps/
    mobile/              Expo app (members, committee, staff)
  supabase/
    migrations/          SQL: tables, RLS policies, functions, triggers
    functions/           Edge Functions (Deno)
    tests/               pgTAP tests
    seed.sql             demo societies and users
    config.jsonc         (Supabase CLI 3 config)
  packages/
    shared/              permission keys, role presets, zod schemas,
                         generated database types
  docs/
    PLAN.md              this plan
```

Never ship the `service_role` key in the app; only Edge Functions use it.

## Multi-tenancy design

Use one Supabase project with a shared schema and a `society_id` column on every tenant table; RLS policies built on a few helper functions enforce isolation in the database itself, whichever client calls it.

**Tenant model**

- `society` is the tenant. Platform tables (`profiles`, `society`, `platform_admin`, `permission`) have no `society_id`; every other table does.
- A person is a Supabase Auth user (`auth.users`, email login: email OTP or Google) with a `profiles` row. One person can own a flat in Society A and be Treasurer in Society B.
- `membership` links a user to a society; `membership_role` holds their roles in it.

**RLS helper functions** (SQL, `security definer`, `stable`, in a `private` schema)

- `is_member(sid uuid)` → true if `auth.uid()` has an active membership in that society.
- `has_permission(sid uuid, perm text)` → true if any of the user's roles in that society includes the permission.
- `my_flat_ids(sid uuid)` → flats the user owns or rents in that society (for `.own` scope). Created in M1 as a stub that returns nothing; M4 replaces it once `flat_occupant` exists.
- `my_billable_flat_ids(sid uuid)` → like `my_flat_ids`, but includes a tenant's flat only when `flat_occupant.can_view_bills` is true. Billing and payment `.own` policies use this one.
- `is_platform_admin()` → true for platform admins.

**Policy pattern for every tenant table**

```sql
alter table complaint enable row level security;

create policy complaint_select on complaint for select using (
  deleted_at is null
  and (
    private.has_permission(society_id, 'complaints.view.all')
    -- own: anything I raised, plus non-private complaints on my flats
    or (private.has_permission(society_id, 'complaints.view.own')
        and (raised_by = (select auth.uid())
             or (not is_private
                 and flat_id in (select private.my_flat_ids(society_id)))))
    or (private.has_permission(society_id, 'complaints.view.assigned')
        and assigned_to = (select auth.uid()))
  )
);
```

Complaints about common areas have `flat_id = null` and are visible under `.own` only to the person who raised them.

- Financial tables (bills, payments, journal entries, expenses after submit) get **no** insert/update/delete policies: they change only through RPC functions that check permissions and write everything in one transaction.
- Index `society_id` on every table and `membership(user_id, society_id)`; wrap `auth.uid()` in `(select ...)` in policies so Postgres evaluates it once per query.

**Tenant integrity (beyond RLS)**

RLS only checks a row's own `society_id`, so these rules close the gaps it leaves:

- **Composite foreign keys.** Every tenant parent table has `unique (society_id, id)`, and every child references it with both columns, e.g. `foreign key (society_id, flat_id) references flat (society_id, id)`. A row in Society A then cannot point at a flat, bill, payment or user record of Society B, even through an RPC bug.
- **Views run as the caller.** Every view is created `with (security_invoker = true)` so the caller's RLS applies (Postgres views otherwise run as their owner and skip RLS). Views that need cross-row aggregation the caller can't see row by row (e.g. dashboard totals) become `security definer` RPCs that check permission first. A CI test fails if any view in `public` lacks `security_invoker`.
- **Storage paths carry the owner.** Member-owned files use `<society_id>/<flat_id>/<uuid>.<ext>` (payment proofs, complaint photos, bills, receipts). Storage policies allow `.all` holders the whole society prefix and `.own` holders only paths whose second segment is in `my_flat_ids` / `my_billable_flat_ids`. Society-wide files (expense attachments, bank statements) use `<society_id>/society/...` and need the module's permission.
- **System callers.** pg_cron jobs and Edge Functions using the service role have `auth.uid() = null`. Each RPC is split: the public function checks `has_permission` and then calls `private.<name>_impl(...)`, which does the work. Cron and webhooks call the `_impl` directly (granted only to `postgres` / `service_role`). The audit trigger records the actor as `auth.uid()` or, when that is null, the value of `current_setting('app.actor', true)` (e.g. `system:interest_cron`, `system:razorpay_webhook`), which each `_impl` caller sets.
- **Membership removal** takes effect at once without revoking JWTs, because every policy reads `membership` live; the app just loses access on its next query.
- **Profiles** (a platform table) are readable by the user themself and by users sharing an active membership with them. Phone and email are visible only to holders of `members.view.all` in a shared society; other members see the name and flat only (through the `member_directory` view).

**Active society in the app**

- After login the app reads `my_memberships` (a view) to list the user's societies and roles.
- One society → open it; more than one → society picker. The app stores the chosen `society_id` and adds `.eq('society_id', activeSocietyId)` to queries. RLS still blocks other societies even if the filter is missing.
- Switching society calls `get_my_permissions(society_id)` and rebuilds the navigation.

**Tenant discovery (society code before login)**

Like HRMS apps such as Darwinbox, the app asks which society you belong to before it shows a login screen. One Supabase project serves every society (pool model), so discovery only picks the society and its branding; it grants nothing, and RLS still decides every read and write after login.

- Every society has a public **society code** (`society.slug`): 3 to 30 lower-case letters, digits and single hyphens, unique, not a reserved word (`www`, `app`, `api`, `admin`, `s`, `login`, `auth`, `help`, `support`, `staging`, `static`). The super-admin sets it at onboarding; only `platform_set_society_slug` changes it, because it is printed on QR codes. Rules live in `packages/shared/src/society-code.ts` and `private.is_valid_society_slug`.
- `discover_society(p_code)` is the one function anon may call. It accepts a typed code (`GreenPark`), a web link (`https://<app>/s/greenpark`), a deep link (`societyapp://s/greenpark`) or a subdomain (`greenpark.<domain>`), and returns only `society_id`, `slug`, `name`, `city`, `logo_url` and `login_methods`. Unknown, suspended, expired, closed and deleted societies all return nothing, so a lookup reveals nothing beyond what a notice board shows.
- Discovery is by code, never by email, so nobody can find out whether an email belongs to a society.
- In the app: enter or scan the code, confirm "Green Park CHS, Andheri West", then a login screen branded for that society with only its `login_methods`. After login, open that society if `my_memberships` has it; otherwise offer a pending invite for it; otherwise say "This email isn't a member of Green Park CHS". People in several societies still switch with the picker; "Join another society" runs discovery again.
- Links and QR codes (`https://<app>/s/<code>`, `societyapp://s/<code>`) open the app on that society's login screen. Welcome emails carry the link and the code.

**Login: email OTP + Google (SMS optional, off by default)**

- A person's identity is their email in `auth.users`. They log in with a 6-digit **email OTP** (`signInWithOtp({ email, options: { shouldCreateUser: false } })`) or **Sign in with Google**. A Google account with the same verified email is linked automatically to the existing user, so anyone created by email can later just tap Google.
- Phase 1 sends no SMS. Phone is optional contact data in `profiles` (used for opt-in WhatsApp and, if SMS is ever switched on, SMS), not a login method unless phone OTP is enabled later.
- Auth emails go through custom SMTP (Resend or Amazon SES) via the Auth **Send Email hook** (`send-email-hook`), which renders branded OTP, welcome and invite emails. Locally, Mailpit (Inbucket) catches them.

**No self-registration**

Nobody can create an account, and so nobody can create a society, on their own:

- **Before User Created hook** (`private.hook_before_user_created`, a Postgres function). It runs for email OTP and Google sign-ins before the user exists. It allows creation only when the email has a pending, unexpired `invite` (member invites, and the committee invites that `admin-onboard-society` writes first). It never trusts who is calling, so the same rule covers the admin API, email OTP and Google. Otherwise it returns "This email isn't registered with any society. Ask your committee."
- **Send Email hook** is the second layer. It sends only to existing users or pending invitees, at most 5 emails per address per hour and 20 per day, under a global daily cap that alerts the super-admin.
- Auth settings: OTP expiry 10 minutes, tightened built-in rate limits, Turnstile CAPTCHA on the email-OTP screen, and the Google OAuth client restricted to the app's redirect URLs.

**Onboarding a new society (super-admin only)**

There is no public sign-up or application form. The super-admin creates every society and its committee. The super-admin's email is allowed once with SQL (`insert into private.platform_admin_email ...`, see docs/AUTH-SETUP.md); their first sign-in creates the account and the `platform_admin` row, never through the app:

1. In the **admin section of the web build**, shown only when `is_platform_admin()` is true, the super-admin fills in the society (name, registration number, address, financial year, billing settings, plan, quotas). Then they add a committee table with one row per person: name, email, optional phone, roles.
2. Submitting calls the Edge Function **`admin-onboard-society`** (service role), which:
   - checks the caller's JWT with `is_platform_admin()`;
   - calls `admin_onboard_begin` (service role only), which runs `private.create_society_impl` (society in status `onboarding`, default roles; chart of accounts, cash account and doc counters are added by M4 and M5) and writes the committee invites in the same transaction;
   - for each committee email, finds the auth user or creates one (`auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name } })`; the pending committee invite lets the Before User Created hook allow it), then calls `admin_onboard_finish`, which adds the memberships and roles, marks the invites accepted and moves the society to `trial` or `active`;
   - sends each committee member a welcome email ("Society X is set up. Log in with this email or Google").
   - If any step fails, it deletes the users it just created and calls `admin_onboard_abort`, which revokes the invites and closes and soft-deletes the half-made society (no hard deletes), then returns an error report. A failed welcome email is reported but rolls nothing back.
3. Committee members log in. Their user already exists, so the hooks let them through. They set up wings, flats and members.
4. Later super-admin actions, all `platform.*` RPCs: `platform_set_committee_member` (add or replace), `platform_set_quotas`, `platform_set_society_status` (suspend, reactivate, close). There is no impersonation; support works from `audit_log` and `job_run`.

**Invite delivery (members)**

- Ordinary members, tenants and staff join only through `create_invite` by the committee. It stores the email, roles, flat and a random token, and refuses once the society's `invites_per_day` or `max_members` quota is reached.
- Delivery: an invite email with the society link `https://<app>/s/<code>`, and/or a **Share invite** button that opens the phone's share sheet so the committee can forward that link on WhatsApp by hand, at no cost.
- At login, any unexpired invite whose email matches the verified email (email OTP or Google) is offered to the user. There is no separate per-invite link: the society link plus the email is enough, and nothing public is looked up by token.
- Invites expire after 7 days. `resend_invite` issues a new token and expiry; `revoke_invite` cancels it. One pending invite per `(society_id, email)`.

**Isolation tests (pgTAP, must pass in CI)**

- A user in Society A selecting from any tenant table sees zero Society B rows.
- A Society A user calling any RPC with Society B's id gets a permission error.
- A CI check fails if any table in `public` has RLS disabled, or any view lacks `security_invoker`.
- Inserting a child row whose `society_id` differs from its parent's (e.g. a Society A `flat_occupant` pointing at a Society B flat) fails on the composite foreign key.
- A Society A member cannot read another flat's objects in `payment-proofs` or `complaints`, and nothing in Society B's prefix.

## Roles and permissions (RBAC)

RLS policies and RPC functions check permissions, never role names: roles are just named sets of permission keys per society, so a society can adjust a role without a code change.

**Rules**

- Permission keys are constants in `packages/shared/permissions.ts`, format `module.action[.scope]`. The app imports them; a migration seeds the same list into a `permission` table so SQL functions can validate role edits.
- Each society gets default roles copied from presets at onboarding. Committee admins can edit them or create custom roles, but cannot grant a permission they don't hold themselves. Roles change only through RPCs (`create_role`, `update_role`, `assign_roles`), never by direct table writes, so this check can't be skipped; every key in `role.permissions` must exist in the `permission` table (checked by trigger).
- **No lockout:** an RPC that would leave a society with no active member holding `roles.manage` is refused.
- A user's effective permissions = the union of all their roles in the active society.
- **Scope:** `.own` permissions are limited to flats linked to the user (as owner or tenant); `.all` permissions cover the whole society. RLS policies apply the flat filter (`my_flat_ids`) when only `.own` is held.
- **Maker-checker:** whoever makes a financial item can never be the one who checks it, whatever permissions they hold:

  | Made by | Checked by (a different user) |
  | --- | --- |
  | Billing run created (`bills.generate`) | `approve_billing_run` (`bills.approve`) |
  | Credit note requested | `approve_credit_note` (`bills.approve`) |
  | Payment submitted or recorded offline | `verify_payment` (`payments.verify`) |
  | Payment reversal or refund requested | `approve_payment_reversal` (`payments.verify`) |
  | Expense created | `approve_expense` (`expenses.approve`) |
  | Expense approved | `pay_expense` (`expenses.pay`), by someone other than the creator |
  | Sensitive setting change requested | `approve_setting_change` (`society.update_sensitive`) |

  Expenses, credit notes and refunds above the society's `approval_limit` (default ₹1,000) need two different approvers. Payment verification always needs one verifier only, because the money is already in the bank and the statement match is the second check.
- `platform.*` permissions belong only to platform admins and are never part of a society role. Phase 1 keys: `platform.societies.create`, `platform.societies.manage` (status, plan, quotas, committee replacement).

**Permission keys (Phase 1)**

| Module | Keys |
| --- | --- |
| Society settings | `society.view`, `society.update`, `society.update_sensitive`, `roles.manage`, `members.invite` |
| Flats and members | `flats.view.all`, `flats.manage`, `members.view.all`, `members.manage`, `members.view.own`, `members.transfer` |
| Billing | `bills.view.own`, `bills.view.all`, `bills.generate`, `bills.approve`, `bills.credit_note`, `bills.resolve_dispute`, `bills.send`, `charge_heads.manage` |
| Payments | `payments.make.own`, `payments.record_offline`, `payments.view.all`, `payments.verify`, `payments.refund` |
| Expenses | `expenses.view`, `expenses.create`, `expenses.approve`, `expenses.pay` |
| Accounts | `accounts.view`, `accounts.manage`, `accounts.opening_balance`, `accounts.close_year`, `reports.view` |
| Dashboard | `dashboard.view` |
| Notices | `notices.view`, `notices.manage` |
| Complaints | `complaints.create`, `complaints.view.own`, `complaints.view.assigned`, `complaints.view.all`, `complaints.assign`, `complaints.update_status`, `complaints.escalation.l1`, `complaints.escalation.l2` |
| Audit | `audit_log.view` |

**Default role presets**

| Role | Gets |
| --- | --- |
| Chairman | Everything except `platform.*` |
| Secretary | Society settings (not `society.update_sensitive`), flats and members, notices, billing (not `bills.approve`), complaints (all, plus `complaints.escalation.l1`), dashboard, reports |
| Treasurer | Billing, payments (including `payments.record_offline` and `payments.verify`), expenses (create, pay), accounts, reports, dashboard |
| Committee member | View everything, `expenses.approve`, `bills.approve`, `payments.verify`, `complaints.assign`, `notices.view` |
| Member (owner) | `bills.view.own`, `payments.make.own`, `members.view.own`, `complaints.create`, `complaints.view.own`, `dashboard.view`, `expenses.view`, `notices.view` |
| Tenant | `complaints.create`, `complaints.view.own`, `dashboard.view`, `notices.view`, `bills.view.own`, `payments.make.own`; the bill keys only reach flats where the owner set `can_view_bills` (enforced by `my_billable_flat_ids`) |
| Staff | `complaints.view.assigned`, `complaints.update_status`, `notices.view` |
| Auditor | All `.view` keys, `reports.view`, `audit_log.view`; no write keys |

The Chairman preset also holds `complaints.escalation.l2`. Because maker-checker applies by user, not role, a Chairman or Treasurer who generates a billing run still needs someone else to approve it.

"View everything" (Committee member, Auditor) means every society-wide view key: `society.view`, `flats.view.all`, `members.view.all`, `bills.view.all`, `payments.view.all`, `expenses.view`, `accounts.view`, `reports.view`, `dashboard.view`, `notices.view`, `complaints.view.all`, `audit_log.view` (not the `.own` or `.assigned` keys). The Treasurer also gets `society.view` and `notices.view`. The exact lists live in `packages/shared/src/role-presets.ts`; the `role_preset` table holds the same, and a database sync test fails if they differ.

## One app, role-based navigation

The app builds its tabs and buttons from the permission set returned by `get_my_permissions(society_id)`, so the same build serves every role.

- A `usePermission('expenses.approve')` hook and a `<Can permission="...">` component hide what the user can't do. RLS and RPC functions still enforce every check; hiding in the UI is only for convenience.
- Expo Router groups: `(auth)` for login and society picker, `(app)` for everything after. Each tab declares the permission it needs; tabs without a match are not registered.
- A user with both a flat and a committee role sees both sets of tabs (for example a Treasurer who also owns a flat sees My Bills and Accounts).

| Tab | Shown when user has | Main screens |
| --- | --- | --- |
| Home | always | Notices, dues summary, quick actions, open complaints |
| My Bills | `bills.view.own` | Bill list, bill PDF, pay by UPI, "I've paid" (UTR + receipt), payment status, receipts, ledger |
| Complaints | `complaints.create` or `complaints.view.assigned` | Raise complaint, my complaints, assigned to me (staff), status updates |
| Transparency | `dashboard.view` | Fund balances, income vs expenses, expense list with bills |
| Billing | `bills.generate` or `bills.view.all` | Charge heads, generate bills, approve, credit notes, payments to verify, bank statement upload, defaulters |
| Expenses | `expenses.create` or `expenses.approve` | New expense, approval queue, pay, vendor receipt |
| Accounts | `accounts.view` | Ledgers, bank reconciliation, reports |
| Society | `flats.manage` or `members.manage` or `roles.manage` | Wings and flats, members, invites, roles, settings (UPI ID, optional Razorpay) |
| Profile | always | Personal details, switch society, logout |

On phones, show up to 5 tabs and put the rest under a More tab; on web, show a side menu.

## Data model

The Phase 1 schema has about 35 tables in the `public` schema, all with RLS enabled. Ids are UUIDs, money columns are `bigint` paise, and every tenant table has `society_id`, `created_at`, `created_by` (default `auth.uid()`), `updated_at`, `deleted_at` (soft delete), plus `unique (society_id, id)` so children can use composite foreign keys.

**Platform (no `society_id`)**

| Table | Key columns |
| --- | --- |
| `auth.users` | Managed by Supabase Auth (email, Google identity, sessions, OTP) |
| `profiles` | id (= auth.users.id), full_name, email (required, mirrors auth), phone (optional contact), whatsapp_opt_in, whatsapp_opt_in_at, avatar_key |
| `society` | id, name, slug (public society code for tenant discovery), logo_path, login_methods (email_otp, google), registration_no, address, gstin, status (onboarding, trial, active, suspended, closed), plan, trial_ends_at, quotas (jsonb: max_flats, max_members, emails_per_month, whatsapp_per_month, sms_per_month (default 0 = SMS off), storage_mb, invites_per_day; set only by `platform.*` RPCs), financial_year_start_month, timezone, locked_until (date; no financial writes on or before it), settings (jsonb: interest rate, grace days, approval_limit, gst_enabled, billing cycle, upi_id, payee_name, razorpay_enabled, rounding) |
| `setting_change` | society_id, key, old_value, new_value, requested_by, approved_by, status (pending, approved, rejected) — for sensitive settings, which change only through it |
| `platform_admin` | user_id |
| `permission` | key, module, description (seeded from `packages/shared`) |
| `platform_config` | single row: sms_enabled (default false), daily email cap, daily SMS cap; super-admin only |

**Access (tenant)**

| Table | Key columns |
| --- | --- |
| `membership` | society_id, user_id, status (invited, active, removed) |
| `role` | society_id, name, is_system, permissions (text[]) |
| `membership_role` | membership_id, role_id |
| `invite` | society_id, kind (member, committee), email, role_ids, flat_id, token, expires_at, status (pending, accepted, revoked, expired) |

**Property (tenant)**

| Table | Key columns |
| --- | --- |
| `wing` | society_id, name |
| `flat` | society_id, wing_id, number, floor, area_sqft, flat_type, parking_slot |
| `flat_occupant` | society_id, flat_id, user_id, type (owner, joint_owner, tenant), share_cert_no, from_date, to_date, can_view_bills |
| `flat_transfer` | society_id, flat_id, from_occupant_ids, to_user_ids, transfer_date, share_cert_no, transfer_fee, noc_attachment_id, status (requested, approved), approved_by |

When `to_date` passes (nightly job) or a transfer is approved, the occupant row closes and the membership becomes `removed` if the user has no other flat or role in the society. Dues stay with the flat, not the person.

**Billing and payments (tenant)**

| Table | Key columns |
| --- | --- |
| `charge_head` | society_id, name, calc_type (per_sqft, flat, by_flat_type, one_time), rate (paise; for per_sqft, paise per sq ft as `numeric(12,4)` input, result rounded per the society's rounding rule), gst_applicable, ledger_account_id |
| `billing_run` | society_id, period_start, period_end, status (draft, approved, sent), created_by, approved_by, sent_at; `unique (society_id, period_start)` |
| `bill` | society_id, billing_run_id, flat_id, bill_no, period, due_date, arrears, interest (from accruals since the last bill), subtotal, gst, advance_applied, total, status (unpaid, verification_pending, partial, paid, disputed), pdf_key |
| `bill_line` | society_id, bill_id, charge_head_id, description, amount |
| `interest_accrual` | society_id, flat_id, bill_id (the overdue bill), accrual_date, days, rate, amount, billed_on_bill_id (null until posted to the next bill) |
| `bill_dispute` | society_id, bill_id, raised_by, reason, status (open, resolved_credit, rejected), resolved_by, resolution_note |
| `credit_note` | society_id, bill_id, amount, reason, requested_by, approved_by, status (pending, approved, rejected) |
| `doc_counter` | society_id, doc_type (bill, receipt, credit_note, voucher), financial_year, last_no — locked with `select ... for update` |
| `payment` | society_id, flat_id, bank_account_id, amount, mode (upi, cash, cheque, razorpay), utr (unique per society), cheque_no, paid_on, proof_path, note, status (submitted, verified, rejected, reversed), submitted_by, verified_by, verified_at, reject_reason, gateway_order_id, gateway_payment_id (unique; Razorpay only) |
| `payment_reversal` | society_id, payment_id, kind (cheque_bounce, wrong_verification, refund), amount, reason, charges, requested_by, approved_by, status |
| `payment_allocation` | society_id, payment_id, bill_id, amount |
| `receipt` | society_id, payment_id, receipt_no, pdf_key |
| `bank_statement_upload` | society_id, file_path, uploaded_by, period_start, period_end |
| `bank_statement_line` | society_id, upload_id, txn_date, direction (credit, debit), utr, amount, narration, matched_payment_id, matched_expense_id, journal_entry_id (for lines posted directly, e.g. bank charges, interest earned) |

**Accounts and expenses (tenant)**

| Table | Key columns |
| --- | --- |
| `ledger_account` | society_id, code, name, type (asset, liability, income, expense, fund), parent_id, is_system; seeded from a chart-of-accounts preset by `create_society` (member receivables, advance from members, interest income, maintenance income, sinking fund, repair fund, GST output, TDS payable, bank, cash, rounding off) |
| `bank_account` | society_id, ledger_account_id, name, bank, account_last4, ifsc, upi_id, is_default; one row of kind cash per society |
| `journal_entry` | society_id, date, narration, source_type (bill, payment, credit_note, expense, reversal, interest, opening, year_close, manual), source_id |
| `journal_line` | society_id, journal_entry_id, ledger_account_id, flat_id (for member receivable / advance sub-ledger), debit, credit |
| `vendor` | society_id, name, phone, gstin, pan, tds_section, bank details (encrypted with Supabase Vault) |
| `expense` | society_id, vendor_id, ledger_account_id, bank_account_id, amount, tds_amount, description, status (draft, pending_approval, approved, rejected, paid), created_by, paid_by |
| `expense_approval` | society_id, expense_id, approver_id, decision, comment |
| `attachment` | society_id, owner_type, owner_id, storage_path, mime, size |

**Complaints (tenant)**

| Table | Key columns |
| --- | --- |
| `complaint_category` | society_id, name, sla_hours |
| `complaint` | society_id, flat_id, raised_by, category_id, title, description, location, is_private, priority, status (open, assigned, in_progress, resolved, closed, reopened), assigned_to, sla_due_at, rating |
| `complaint_event` | society_id, complaint_id, actor_id, type, from_status, to_status, comment, escalation_level |

**Notices and notifications (tenant)**

| Table | Key columns |
| --- | --- |
| `notice` | society_id, title, body, audience (all, owners, wing_ids), attachment_id, pinned, published_at, expires_at |
| `device` | user_id (platform table, no society_id), expo_push_token, platform, last_seen_at |
| `notification_pref` | user_id, channel (push, email, whatsapp, sms), event_type, enabled; `sms` is offered only when SMS is enabled |
| `notification` | society_id, user_id, event_type, title, body, data (jsonb), channels_sent, read_at — in-app inbox and delivery log |

`device` and `notification_pref` belong to the user, not a society: RLS limits them to `user_id = auth.uid()`.

**Usage (tenant)**

| Table | Key columns |
| --- | --- |
| `society_usage` | society_id, month, emails_sent, whatsapp_sent, sms_sent, storage_bytes, invites_sent — written only by `notify`, `send-email-hook`, `create_invite` and the upload path; readable by the society's committee (`society.view`) and platform admins |

**Audit (tenant, append-only)**

| Table | Key columns |
| --- | --- |
| `audit_log` | society_id, actor_id, actor_label (e.g. `system:interest_cron` when there is no user), action, table_name, row_id, before (jsonb), after (jsonb), created_at |
| `job_run` | society_id, job, started_at, finished_at, status, error — readable by platform admins only |

Child tables also carry `society_id` so each RLS policy checks its own column without a join, and reference their parent with a composite `(society_id, parent_id)` foreign key. Unique constraints: `(society_id, bill_no)`, `(society_id, receipt_no)`, `(society_id, utr)` on payment, `(society_id, wing_id, number)` on flat, `(society_id, user_id)` on membership, `(society_id, period_start)` on billing_run.

**Views** (all `security_invoker = true`): `my_memberships`, `member_directory`, `flat_ledger` (member statement: bills, payments, credit notes, interest, running balance per flat), `defaulters` (ageing buckets).

**Storage buckets** (private): `bills`, `receipts`, `attachments`, `payment-proofs`, `bank-statements`, `complaints`. Paths are `<society_id>/<flat_id>/...` for flat-owned files and `<society_id>/society/...` for society-wide ones; policies check the first segment with `is_member` / `has_permission` and the second with `my_flat_ids` for `.own` holders (see Tenant integrity).

## Backend surface: tables, RPC functions, Edge Functions

The app talks to Supabase three ways: direct table access for reads and simple writes (RLS decides), RPC functions for anything that moves money or changes several tables, and Edge Functions for work that needs secrets or outside services.

**Direct table access (supabase-js, RLS-guarded)**

| Area | App can read | App can write directly |
| --- | --- | --- |
| Society and roles | `society`, `role`, `setting_change`, `my_memberships` view | non-sensitive `society` fields (name, address, `settings.billing_cycle`) with `society.update`; roles and sensitive settings via RPC only |
| Flats and members | `wing`, `flat`, `flat_occupant`, `flat_transfer`, `member_directory` view | wings, flats, occupants (`flats.manage`, `members.manage`) |
| Billing | `bill`, `bill_line`, `charge_head`, `billing_run`, `credit_note`, `bill_dispute`, `interest_accrual`, `flat_ledger` view | `charge_head` (`charge_heads.manage`) |
| Payments | `payment`, `payment_reversal`, `receipt`, `bank_statement_line`, `bank_account` | none (use RPC) |
| Expenses and accounts | `expense`, `vendor`, `ledger_account`, `journal_entry`, `journal_line` | draft `expense`, `vendor` (`expenses.create`); non-system `ledger_account` rows (`accounts.manage`) |
| Notices | `notice` (`notices.view`) | `notice` (`notices.manage`) |
| Notifications | own `notification`, `device`, `notification_pref` | own `device`, `notification_pref`, `notification.read_at` |
| Complaints | `complaint`, `complaint_event`, `complaint_category` | insert `complaint` (`complaints.create`), `complaint_category` |
| Dashboard | none directly | none (dashboard data comes from the `get_dashboard` RPC) |
| Audit | `audit_log` (`audit_log.view`) | none |

**RPC functions (Postgres, `security definer`, each checks `has_permission` first)**

Every financial RPC also refuses a date on or before `society.locked_until`, and locks the row it changes (`select ... for update`) so two users can't act on the same item at once. Each one is a thin public wrapper over a `private.<name>_impl` (see Tenant integrity → System callers).

| Function | Does | Permission |
| --- | --- | --- |
| `get_my_permissions(society_id)` | Returns the user's effective permission keys | member |
| `private.create_society_impl(...)` | Creates society, default roles, chart of accounts, cash account, doc counters; called only by `admin-onboard-society` | service role |
| `platform_set_society_status(id, status)`, `platform_set_quotas(id, plan, quotas)`, `platform_set_committee_member(society_id, email, role_ids, action)` | Super-admin management of a society | `platform.societies.manage` |
| `private.society_is_active(sid)` | True when status is `trial` (before `trial_ends_at`) or `active`; every write policy and write RPC checks it | helper |
| `create_invite(...)`, `resend_invite(id)`, `revoke_invite(id)`, `accept_invite(token)` | Invites by email (see Invite delivery), within quota; links user, flat and roles on accept | `members.invite` / invitee |
| `create_role(...)`, `update_role(...)`, `assign_roles(membership_id, role_ids)` | Role edits; refuse permissions the caller lacks, unknown keys, or leaving nobody with `roles.manage` | `roles.manage` |
| `request_setting_change(key, value)`, `approve_setting_change(id, decision)` | Sensitive settings (UPI ID, payee, approval_limit, interest rate, grace days, razorpay_enabled, GST) change only after a second user approves; the committee is notified | `society.update` / `society.update_sensitive` |
| `request_flat_transfer(...)`, `approve_flat_transfer(id)` | Closes old occupants, adds new ones, records share certificate and transfer fee, deactivates memberships left with nothing | `members.manage` / `members.transfer` |
| `post_opening_balances(as_of, rows)` | One-time opening entry: per-flat arrears and advances, fund, bank and cash balances, as one balanced journal entry; refused once any bill exists | `accounts.opening_balance` |
| `create_billing_run(society_id, period)` | Builds draft bills: charge-head lines, unbilled interest accruals, arrears, advance applied | `bills.generate` |
| `approve_billing_run(run_id)` | Refused for the run's creator; locks bills, assigns bill numbers, posts journal entries, marks accruals billed | `bills.approve` |
| `send_billing_run(run_id)` | Generates PDFs and notifies each flat's billable occupants with a link; status `sent` | `bills.send` |
| `request_credit_note(bill_id, amount, reason)`, `approve_credit_note(id, decision)` | Credit note + reversal entry after maker-checker | `bills.credit_note` / `bills.approve` |
| `raise_bill_dispute(bill_id, reason)` | Opens a dispute, pauses interest on that bill | `bills.view.own` |
| `resolve_bill_dispute(id, outcome, note)` | Rejects it (interest resumes from the resolution date) or resolves it by requesting a credit note | `bills.resolve_dispute` |
| `submit_payment(flat_id, amount, mode, utr, paid_on, proof_path, note)` | Member (or treasurer, for cash or cheque) claims a payment; rejects a duplicate UTR; status `submitted`, the flat's unpaid bills show "verification pending" | `payments.make.own` / `payments.record_offline` |
| `verify_payment(payment_id, decision, reason)` | Approve: allocates oldest bill first (excess to advance), issues receipt number, posts journal entry, status `verified`. Reject: status `rejected` with reason, bills back to unpaid, member notified. Refused if the verifier submitted the payment | `payments.verify` |
| `request_payment_reversal(payment_id, kind, reason, charges)`, `approve_payment_reversal(id)` | Cheque bounce, wrong verification or refund: reversal journal entry, unallocates and reopens bills, optional bounce charge on the next bill, status `reversed` | `payments.refund` / `payments.verify` |
| `match_bank_statement(upload_id)` | Matches credits to submitted payments by UTR and amount (one-tap verification) and debits to paid expenses by amount and date | `payments.verify` |
| `post_bank_line(line_id, ledger_account_id)` | Posts an unmatched statement line (bank charges, interest earned) as a journal entry | `accounts.manage` |
| `record_gateway_payment(...)` (optional Razorpay) | Records a Razorpay payment as verified (the gateway is the proof), allocates, receipt, journal entry; idempotent on `gateway_payment_id`; called only by the webhook function | service role (`_impl` only) |
| `submit_expense(id)`, `approve_expense(id, decision)`, `pay_expense(id, bank_account_id)` | Maker-checker workflow (creator can neither approve nor pay), TDS split, journal entries | `expenses.*` |
| `assign_complaint(id, user_id)`, `update_complaint_status(id, status, comment)`, `rate_complaint(id, rating)` | Status flow with events and SLA | `complaints.*` |
| `get_dashboard(society_id, from, to)` | Fund balances, income vs expenses, expense list with attachments | `dashboard.view` |
| `report_income_expenditure`, `report_balance_sheet`, `report_trial_balance`, `report_member_statement`, `report_defaulters` | Accounting reports for a date range; Excel export via `generate-pdf`/`export-report` | `reports.view` |
| `close_financial_year(fy)` | Checks the trial balance, posts closing entries (income and expense to surplus/deficit), carries balances forward, sets `locked_until` to the year end | `accounts.close_year` |

**Edge Functions (Deno)**

| Function | Does |
| --- | --- |
| `parse-bank-statement` | Reads an uploaded bank statement (CSV or Excel) into `bank_statement_line` rows, then calls `match_bank_statement` |
| `generate-pdf` | Renders bill and receipt PDFs into Storage (pdf-lib with an embedded Noto Sans + Noto Sans Devanagari font, so ₹ and Marathi/Hindi render) |
| `export-report` | Writes report results to Excel for the statutory auditor |
| `import-flats` | Parses an Excel upload, validates, inserts flats and occupants, returns an error report |
| `import-opening-balances` | Parses an Excel of per-flat arrears/advances and ledger balances, validates that it balances, calls `post_opening_balances` |
| `notify` | Writes a `notification` row, then sends Expo push, email and (opt-in, approved templates) WhatsApp according to `notification_pref`; paid channels are counted in `society_usage` and skipped once the society's quota is used; prunes dead push tokens |
| `admin-onboard-society` | Super-admin only: creates the society and its committee accounts in one flow, with rollback on failure (see Onboarding) |
| `send-email-hook` | Supabase Auth Send Email hook: sends OTP, welcome and invite emails via Resend/SES, only to known users or pending invitees, with per-address and global caps |
| `payments-create-order` (optional) | Only for societies with Razorpay enabled: creates a Razorpay order with that society's own keys |
| `payments-webhook` (optional) | Verifies the Razorpay signature with that society's webhook secret, calls `record_gateway_payment` |
| `payments-reconcile` (optional) | Nightly, for Razorpay societies: checks stuck orders with the Razorpay API |

## Cross-cutting rules

These rules apply to every module and are non-negotiable.

**Money and accounting**

- Store money as `bigint` paise, never floats or `numeric` in JavaScript. Format as ₹ only in the UI and PDFs.
- Every bill approval, verified payment, credit note and paid expense creates a balanced journal entry (total debit = total credit) inside the same RPC function, so it all commits or none of it does.
- Approved bills, verified payments and journal entries are never deleted, and their money fields never change (no RLS write policies, plus a trigger that raises an error). The trigger has a column whitelist: on an approved `bill` only `status`, `pdf_key` and `updated_at` may change; on a verified `payment` only `status` (to `reversed`, by the reversal RPC) and `updated_at`; `journal_entry` / `journal_line` allow nothing. Corrections go through credit notes or reversal entries.
- Bill, receipt, credit note and voucher numbers are sequential per society and financial year (e.g. `2026-27/000123`), taken from a `doc_counter` row locked with `select ... for update` inside the RPC.
- **Rounding:** line amounts are computed in exact numeric, then rounded per `settings.rounding` (default: each bill line to the nearest rupee, half up). Interest is rounded to the nearest rupee per accrual. Any difference posts to the Rounding Off ledger account. No float arithmetic anywhere.
- **Interest:** simple interest at the society's rate (capped at 21% p.a., the Maharashtra bye-law limit; configurable) on the overdue principal after the grace period. Interest on interest is not charged. A nightly cron writes `interest_accrual` rows; it never changes an approved bill. The next billing run adds unbilled accruals as an Interest line and journal entry. No interest accrues while a bill has a submitted (pending) payment or an open dispute.
- **Member ledger:** every journal line touching Member Receivables or Advance from Members carries `flat_id`, so `flat_ledger` gives each flat's statement and arrears without a separate balance table.
- **Allocation:** always oldest unpaid bill first, regardless of what the member selects; any excess posts to Advance from Members for that flat and is applied automatically by the next billing run (`bill.advance_applied`).
- **Opening balances:** a society starting mid-life posts one opening journal entry (per-flat arrears and advances, fund, bank and cash balances) before its first billing run. Arrears then appear on the first bill.
- **Period lock and year close:** `society.locked_until` blocks every financial write dated on or before it. `close_financial_year` checks the trial balance, closes income and expense to the surplus/deficit account and moves `locked_until` to the year end. Reopening a closed year is a platform-admin action, logged.
- **GST and TDS (Phase 1 scope):** `gst_enabled` is off by default. When on, GST at 18% applies only to flats whose monthly maintenance exceeds ₹7,500 (the housing-society exemption), on the full amount, posted to GST Output; the bill shows the society's GSTIN. TDS on vendor expenses is recorded per `vendor.tds_section` and posted to TDS Payable. Filing returns stays outside the app.
- Dates in `Asia/Kolkata`; financial year April to March by default.

**Audit log**

- A generic trigger function on every tenant table writes an `audit_log` row for each insert, update and delete, with before and after values and `auth.uid()` (or `app.actor` for system jobs) as the actor. The trigger function and `audit_log` are created in M1, and every migration that adds a tenant table attaches the trigger in the same file.
- `audit_log` has a select policy only; update and delete are revoked from all roles except the database owner.
- Soft delete (`deleted_at`) for business records; RLS policies hide soft-deleted rows.

**Payments**

- **Default, direct UPI (no gateway fee):** the app opens the member's UPI app with a UPI payment link (society's UPI ID, amount, bill number in the note) or shows a QR. The UPI ID must be the society's current account, never a personal one, and changing it needs a second approver. On desktop web and when no UPI app answers the link (common on iOS), show the QR and the UPI ID to copy; test `upi://` handling on iOS early in M6.
- After paying, the member taps "I've paid", enters the UTR (required), and adds a receipt screenshot and optional note → `submit_payment`. Bills show "verification pending".
- A committee member with `payments.verify` approves or rejects in the verification queue → `verify_payment`. Only on approval is the bill marked paid, the receipt issued and the journal entry posted. The submitter can never verify their own payment.
- Bank statement upload matches credits to submitted payments by UTR and amount, so verifiers can approve matched ones in one tap and focus on the rest.
- A UTR is unique per society, so one payment can't be claimed twice. Rejected claims notify the member with the reason.
- Cash and cheque: the treasurer submits them the same way, and a different committee member verifies.
- **Reversals:** a bounced cheque, a mistaken verification or a refund goes through `request_payment_reversal` and a second user's approval. It posts a reversal entry, reopens the bills (interest resumes from the original due date), and can add a bounce charge to the next bill.
- **Optional, Razorpay per society:** a society can turn on `razorpay_enabled` and add its own Razorpay keys (stored in Supabase Vault, per society). Then the app also offers "Pay online"; `payments-webhook` verifies the signature and records the payment as verified automatically. Gateway fees go to that society's own Razorpay account. `gateway_payment_id` is unique, so repeated webhooks change nothing.
- Allocation: oldest unpaid bill first; excess stays as advance credit on the flat.

**Scheduled jobs (Supabase Cron)**

- Monthly or quarterly: create draft billing runs for each society due that day (SQL function).
- Nightly: interest accrual (SQL), occupant `to_date` expiry, invite expiry, trial expiry, due reminders, a nudge to verifiers about payments pending over 48 hours, and Razorpay reconciliation for societies that use it (Edge Functions called via `pg_net`).
- Every 15 minutes: SLA escalation — an overdue complaint notifies holders of `complaints.escalation.l1`; if still overdue after another SLA period, holders of `complaints.escalation.l2`. Never by role name.
- Jobs call `private.*_impl` functions with `app.actor` set to `system:<job>`, loop over societies and run each society's work in its own transaction, so one failure doesn't stop the rest. Failures are written to a `job_run` log table and reported to Sentry.

**Notifications**

- `notify` arrives in M5 (bills sent), and every later milestone uses it: payment rejected or verified, reminders, notices, complaint updates, setting changes.
- Every notification is also an in-app `notification` row and a push, both free, so nothing depends on a paid channel. Users choose extra channels per event type in `notification_pref`.
- Email: bill ready (PDF link), receipt, payment verified or rejected, reminders, invites.
- WhatsApp (opt-in only, as Meta requires; `profiles.whatsapp_opt_in` plus a phone number): only for bill ready, payment rejected and final reminder. Before the pilot, get these WhatsApp Business templates approved.
- SMS is off in Phase 1, for login and notifications. It can be switched on later without schema changes (see Optional SMS).

**Optional SMS (built later, only if needed)**

The design leaves room for SMS, but Phase 1 builds none of it:

- **Two switches, both off by default:**
  - A platform-wide `platform_config.sms_enabled` flag that only the super-admin can set.
  - A per-society `quotas.sms_per_month`, which defaults to 0.

  SMS is sent only when both allow it.
- **Uses, if switched on:**
  - SMS as a notification channel (bill ready, payment rejected, final reminder).
  - Optional phone OTP as an extra login method for members without email.
- **How it plugs in:**
  - `notify` gets an SMS channel.
  - A `send-sms-hook` (Auth Send SMS hook) goes to a DLT-registered Indian provider (MSG91 or similar).
  - DLT sender ID and templates are registered before launch.
- **The same cost rules apply:**
  - SMS goes only to existing users or pending invitees.
  - The Before User Created hook still requires an invite.
  - +91 numbers only.
  - Per-phone limits (3 per 15 minutes, 10 per day) and a global daily cap.
  - Counted in `society_usage.sms_sent`; once the quota is used up, it falls back to push and email.

**Cost and abuse controls**

- Only the super-admin creates societies and committee accounts; nobody can self-register (see Login, No self-registration and Onboarding).
- No paid message (email, WhatsApp) goes to an address that is not an existing user or a pending invitee.
- Each society's paid usage is counted in `society_usage` against `society.quotas`:
  - `create_invite` refuses past `invites_per_day` or `max_members`.
  - Flat inserts and `import-flats` refuse past `max_flats`.
  - `notify` skips email, WhatsApp and (if enabled) SMS once `emails_per_month` / `whatsapp_per_month` / `sms_per_month` is used up, and falls back to push and the inbox.
  - Uploads are refused past `storage_mb`.
- Login OTP emails count against a platform-wide daily cap, not the society's quota; a spike alerts the super-admin.
- **Suspended or expired societies are read-only:** every write policy and write RPC also checks `private.society_is_active(society_id)`, and no paid messages are sent. A nightly job moves trials past `trial_ends_at` to `suspended`.

**Data privacy (DPDP Act 2023)**

- Consent notice at first login; privacy policy linked in the app and in store listings.
- "Delete my account" request: removes the profile's personal fields, devices and preferences, and ends memberships. Financial records (bills, payments, journal lines) are kept for statutory retention (8 years), linked to the flat rather than the person.
- No personal data in logs, Sentry events or URLs.

**Localization**

- UI strings through i18n (English, Marathi, Hindi), chosen per user; bills and receipts in the society's chosen language. Amounts in Indian digit grouping (₹1,23,456).

**App platforms**

- Native: session in `expo-secure-store`. Web: supabase-js default storage (localStorage) with short session lifetime; no `expo-secure-store` on web.
- OTA updates through EAS Update with separate `staging` and `production` channels.

**Security**

- RLS enabled on every table and storage bucket; a pgTAP test fails CI if any table lacks it or any view lacks `security_invoker`.
- Composite `(society_id, id)` foreign keys between all tenant tables.
- `security definer` functions live in a `private` schema or set `search_path = ''`, and check `has_permission` before doing anything.
- The `anon` key is the only key in the app; the `service_role` key lives only in Edge Function secrets.
- Email OTP: 10-minute expiry, tightened Supabase Auth rate limits, Turnstile CAPTCHA on from M1; self-registration blocked by the Before User Created hook (see No self-registration).
- Validate inputs with zod in the app and with constraints and checks in SQL.
- Files: private buckets, type and size limits (images and PDF, 10 MB), signed URLs for download.
- Vendor bank details and Razorpay keys encrypted (Supabase Vault); no personal data in logs.

## Build order

Build one milestone at a time, in this order, and don't start the next until its acceptance checks pass. Each milestone ships with tests for its acceptance criteria.

### M0. Repo, Supabase and delivery pipeline

- pnpm + Turborepo monorepo with `apps/mobile`, `supabase/`, `packages/shared`; TypeScript strict, ESLint, Prettier.
- `supabase init`, `supabase start` for local dev; type generation script (`supabase gen types typescript` into `packages/shared`).
- GitHub Actions: lint, type-check, `supabase db reset` + `supabase test db`, app tests.
- A staging Supabase project from day one: CI runs `supabase db push` and `supabase functions deploy` to staging on merge to `main`. A checklist of Edge Function secrets (SMTP / Resend, Google OAuth, WhatsApp, Sentry, Razorpay) lives in `docs/`, values only in Supabase secrets.
- EAS project with `staging` and `production` update channels.
- **Done when:** `supabase start` and `pnpm dev` run locally; CI is green and deploys migrations to staging.

### M1. Auth, multi-tenancy core and audit

- Migrations: `profiles` (with trigger on new auth user), `society` (with status, plan, quotas), `platform_admin` (super-admin seeded), `membership`, `role`, `membership_role`, `invite`, `society_usage`, `audit_log`, `job_run`.
- Common columns (including `deleted_at`), `unique (society_id, id)` and composite-FK convention; generic audit trigger, attached to every tenant table from here on; immutability-trigger helper with column whitelist.
- RLS helper functions (`is_member`, `has_permission`, `my_flat_ids` and `my_billable_flat_ids` as stubs until M4, `is_platform_admin`) and policies on these tables; `app.actor` convention for system callers.
- Email OTP and Google login on the backend (local: Mailpit catches the 6-digit code emails); Before User Created hook; `send-email-hook` (hosted projects only, see docs/AUTH-SETUP.md); `private.society_is_active` in write policies.
- `admin-onboard-society` Edge Function; `platform_set_*` RPCs; `create_invite`, `resend_invite`, `revoke_invite`, `my_pending_invites`, `accept_invite`; `seed.sql` with 2 demo societies (M2 adds a user for each role preset).
- The login screens, Turnstile on the code screen and the super-admin's admin section are app work and ship in M3, on top of the app shell.
- CI checks: RLS on every table, `security_invoker` on every view.
- **Done when:** all pgTAP isolation tests in the Multi-tenancy section pass; an insert into an M1 table appears in `audit_log` with its actor; an OTP request or Google sign-in for an uninvited email is rejected and sends nothing; a non-admin can't onboard a society; a committee member created by the super-admin can log in; a suspended society refuses writes but allows reads.

### M2. Roles and permissions

- Permission keys and role presets in `packages/shared`; migration seeds the `permission` table; `create_society` creates default roles.
- `get_my_permissions`, `create_role`, `update_role`, `assign_roles` (refuse permissions the caller lacks, unknown keys, and removing the last `roles.manage` holder); no direct write policy on `role`.
- `setting_change` with `request_setting_change` / `approve_setting_change` for sensitive settings: `upi_id`, `payee_name`, `approval_limit` (paise), `interest_rate` (% a year, 0 to 21), `grace_days` (0 to 90), `gst_enabled`, `razorpay_enabled`, `rounding`. The approver needs `society.update_sensitive` and can never be the requester. `update_society_settings` changes non-sensitive settings (`billing_cycle`) directly with `society.update`.
- `role_preset` table seeded from `packages/shared`; a database sync test (`pnpm --filter @society/shared test:db`, run in CI) checks the `permission` and `role_preset` tables match the shared code.
- **Done when:** pgTAP tests prove each default role can read and write only what its permissions allow; a user can't grant a key they lack, either by RPC or by direct table write; changing the UPI ID needs a second user.

### M2.1. Tenant discovery

- `society.slug`, `logo_path`, `login_methods`; slugs backfilled for existing societies; `create_society_impl` requires a slug; `discover_society` (anon) and `platform_set_society_slug`; `packages/shared/src/society-code.ts`; onboarding schema and `admin-onboard-society` take the code, and welcome emails carry the society link.
- **Done when:** anyone can look up an active society by code, link or subdomain and gets only public details; hidden societies return nothing; anon can still read no table; slug rules, uniqueness and super-admin-only changes are enforced.

### M3. App shell

- Expo Router with `(auth)` and `(app)` groups; email OTP and Google login screens with a clear "not registered, ask your committee" message and Turnstile on the code screen; pending invites offered after login (`my_pending_invites`, `accept_invite`); consent notice; society picker; session in secure storage (native) / web storage (web).
- Tenant discovery screens: "Enter your society code" (type, scan QR, or open a `/s/<code>` link) calling `discover_society`; the chosen society is remembered; a login screen branded for it with only its `login_methods`; the "not a member of this society" message with "Use a different email" and "Change society"; universal and deep links (`https://<app>/s/<code>`, `societyapp://s/<code>`).
- Admin section of the web build, shown only to platform admins: onboard a society with its committee and society code (calls `admin-onboard-society`; suggests a code from the name with `suggestSocietySlug`), list societies, change status, quotas and code, and print the society's QR code for the notice board.
- Permission-driven tab bar, `usePermission` and `<Can>`; Home and Profile; society switching; i18n set up with English, plus Marathi and Hindi string files.
- `device` table and push-token registration.
- **Done when:** logging in as a member, a treasurer and a staff user shows three different tab sets from the same build, on Android and on web.

### M4. Wings, flats, members and opening balances

- Tables and RLS for wings, flats, occupants and transfers (composite FKs); real `my_flat_ids` and `my_billable_flat_ids`; `member_directory` view; email invite flow in the app with the Share invite link; `import-flats` Edge Function with error report.
- Flat transfer and occupant expiry (nightly job).
- Chart-of-accounts preset, `ledger_account`, `bank_account`, `journal_entry`, `journal_line` with the balanced-entry check; `post_opening_balances` and `import-opening-balances`.
- **Done when:** a Secretary imports 100 flats from Excel, invites owners, and owners see only their own flat; a tenant without `can_view_bills` sees no billing data; opening balances for 100 flats import as one balanced entry and show on each `flat_ledger`.

### M5. Billing and notifications

- Charge heads, `doc_counter`, `create_billing_run`, `approve_billing_run` (not by its creator), `send_billing_run`; credit notes with maker-checker; disputes and their resolution; interest accrual cron into `interest_accrual`; rounding rules; `generate-pdf` with Indian fonts.
- `notify` (push and in-app inbox always; email; WhatsApp opt-in behind templates), `notification`, `notification_pref`; counting into `society_usage` and quota fallback.
- Notices (`notice` table, screens, `notices.manage`).
- My Bills (with member statement) and Billing screens.
- **Done when:** a run produces correct bills for per-sq-ft, flat-rate and one-time heads, including arrears, interest from accruals and advance applied; totals match journal entries; the run's creator can't approve it; an approved bill's amounts can't be updated even with direct SQL as an app user, while its status can change through RPC; a sent run delivers a push and inbox notification to each billable occupant.

### M6. Payments

- Society UPI settings (through `request_setting_change`); UPI link and QR in the app, QR fallback on web and iOS; `submit_payment` with UTR, receipt upload and note; verification queue and `verify_payment` (oldest-first allocation, advance); receipts; reversals and refunds; defaulter view with ageing.
- Bank statement upload: `parse-bank-statement` + `match_bank_statement` (credits and debits), `post_bank_line`.
- Optional Razorpay: per-society keys in Vault, `payments-create-order`, `payments-webhook`, `record_gateway_payment`, `payments-reconcile`, shown only when `razorpay_enabled`.
- **Done when:** a submitted payment stays unpaid until a different committee member verifies it; a duplicate UTR is refused; two verifiers acting at once produce one result; a statement upload auto-matches by UTR and amount; partial and advance payments allocate correctly; a bounced cheque reopens the bills and posts a reversal; with Razorpay on, a test-mode payment is verified only by the webhook and a repeated webhook changes nothing.

### M7. Expenses and accounts

- Vendors (bank details in Vault), expenses with attachments in Storage, `submit_expense` / `approve_expense` / `pay_expense` with TDS, report functions, `export-report`, `close_financial_year` and the period lock.
- **Done when:** the creator can't approve or pay their own expense; amounts over `approval_limit` need two approvers; the trial balance always balances; after a year close, no financial RPC accepts a date in that year.

### M8. Complaints

- Categories with SLA, raise with photos (flat-scoped storage paths), assign, status flow, rating, emergency flag; SLA escalation cron by escalation permission; Realtime updates; notifications.
- **Done when:** staff see only assigned complaints; an overdue complaint escalates to l1 then l2 holders on schedule; members see their own complaints and non-private ones on their flat, never another member's private complaint or its photos.

### M9. Transparency dashboard and audit viewer

- `get_dashboard` RPC and screens; audit log viewer with filters.
- **Done when:** the dashboard matches the trial balance for the same period; every write from M1–M8 appears in `audit_log` with before and after values and a user or `system:` actor; no app user can update or delete audit rows.

### M10. Hardening and pilot

- Production Supabase project in the Mumbai region (if available on your plan), Pro plan with daily backups and point-in-time recovery; Sentry; EAS builds for Android and iOS; web deploy.
- App E2E tests with Maestro for the main flows (login, pay and verify, raise complaint, approve expense).
- Load check: 1,000 flats × 12 billing runs × payments; billing run, `flat_ledger` and reports stay under 2 seconds.
- Backup-restore drill into a scratch project; WhatsApp templates approved; SMTP domain set up with SPF, DKIM and DMARC; super-admin view of each society's usage against quotas; privacy policy and account-deletion flow live; store listings.
- Optional: per-society subdomains for the web build (`<code>.<domain>`, wildcard DNS and TLS); `discover_society` already accepts that form.
- Pilot in one society, with its opening balances imported.

## Open decisions

Decide these before the milestone named; until then the default holds.

| Decision | Default until decided | Needed by |
| --- | --- | --- |
| GST: whether to support it in Phase 1 at all, and the exact rule for the ₹7,500 exemption (full amount vs excess) | Off; rule as in Cross-cutting rules | M5 |
| Statutory registers (I form, J form, share register) and Tally export | Phase 2; Excel export of reports in Phase 1 | M7 |
| Platform admin: admin section in the web build vs separate console | Admin section in the web build | M1 |
| Members with no email address | Committee helps them create a Gmail, or adds a family member's email as joint occupant; no phone/password login | M4 |
| Default quotas per plan (flats, members, emails, WhatsApp, storage, invites per day) | Pilot plan: 300 flats, 1,000 members, 5,000 emails and 500 WhatsApp per month, 2 GB, 100 invites per day | M1 |
| How societies pay the platform | Invoiced outside the app; super-admin sets status | M10 |
| Tie first sign-up to the discovered society (the app passes `society_slug` in sign-up metadata and the Before User Created hook checks the invite is for that society) | Not needed for security; invites and RLS already decide membership | M3 |
| Whether to switch on SMS (notifications and/or phone OTP login) | Off; build the Optional SMS design only if pilot feedback needs it | After pilot |
| Languages at pilot: Marathi and Hindi translations complete, or English only | English complete, others as string files | M10 |
| Interest cap and whether a society may charge compound interest | 21% p.a. simple, no compounding | M5 |
| Data retention period after account deletion | 8 years for financial records | M10 |
