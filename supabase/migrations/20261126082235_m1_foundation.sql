-- M1 foundation: private schema, generic triggers, platform tables, tenant core tables.
-- RLS policies, helper functions and RPCs follow in the next migrations.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blocks changes to a locked row. Arguments:
--   TG_ARGV[0]  column that decides whether the row is locked (e.g. 'status')
--   TG_ARGV[1]  comma-separated values of that column that lock the row (e.g. 'approved,sent')
--   TG_ARGV[2…] columns that may still change on a locked row (e.g. 'status', 'pdf_key')
-- updated_at is always allowed. Deleting a locked row is always refused.
create or replace function private.guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lock_column text := tg_argv[0];
  locked_values text[] := string_to_array(tg_argv[1], ',');
  allowed text[] := array['updated_at'];
  old_row jsonb := to_jsonb(old);
  new_row jsonb;
  col text;
  i int;
begin
  if not (old_row ->> lock_column = any (locked_values)) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'immutable_row: % % is locked and cannot be deleted', tg_table_name, old_row ->> 'id'
      using errcode = 'P0001';
  end if;

  for i in 2 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
    allowed := allowed || tg_argv[i];
  end loop;

  new_row := to_jsonb(new);
  for col in select jsonb_object_keys(new_row) loop
    if not (col = any (allowed)) and (new_row -> col) is distinct from (old_row -> col) then
      raise exception 'immutable_row: column % of locked % % cannot change', col, tg_table_name, old_row ->> 'id'
        using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  society_id uuid,
  actor_id uuid,
  actor_label text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  row_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_society_created_idx on public.audit_log (society_id, created_at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);
alter table public.audit_log enable row level security;

-- Writes one audit_log row per changed row. The actor is the signed-in user, or
-- for system callers (cron, webhooks, service role) the label in app.actor.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  any_row jsonb := coalesce(new_row, old_row);
  sid uuid;
  uid uuid := auth.uid();
begin
  sid := case
    when tg_table_name = 'society' then (any_row ->> 'id')::uuid
    else (any_row ->> 'society_id')::uuid
  end;

  insert into public.audit_log (society_id, actor_id, actor_label, action, table_name, row_id, before, after)
  values (
    sid,
    uid,
    coalesce(uid::text, nullif(current_setting('app.actor', true), ''), 'db:' || current_user),
    tg_op,
    tg_table_name,
    coalesce(any_row ->> 'id', any_row ->> 'user_id'),
    old_row,
    new_row
  );
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform tables (no society_id)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text check (email = lower(email)),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  avatar_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index profiles_email_key on public.profiles (email) where email is not null;
alter table public.profiles enable row level security;

create table public.platform_admin (
  user_id uuid primary key references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.platform_admin enable row level security;

-- Emails allowed to sign up as super-admin. Not exposed through the API: rows are
-- added with SQL only (migration, seed or SQL editor).
create table private.platform_admin_email (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.platform_config (
  id boolean primary key default true check (id),
  sms_enabled boolean not null default false,
  daily_email_cap integer not null default 2000 check (daily_email_cap >= 0),
  daily_sms_cap integer not null default 0 check (daily_sms_cap >= 0),
  email_per_address_hourly integer not null default 5 check (email_per_address_hourly >= 0),
  email_per_address_daily integer not null default 20 check (email_per_address_daily >= 0),
  updated_at timestamptz not null default now()
);
insert into public.platform_config (id) values (true);
alter table public.platform_config enable row level security;

create table public.permission (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+(\.[a-z_0-9]+)*$'),
  module text not null,
  description text not null
);
alter table public.permission enable row level security;

-- M1 keys. M2 adds the full Phase 1 list; packages/shared/src/permissions.ts is the source of truth.
insert into public.permission (key, module, description) values
  ('society.view', 'society', 'View society details'),
  ('society.update', 'society', 'Edit society name and address'),
  ('roles.manage', 'society', 'Create and edit roles, assign roles to members'),
  ('members.invite', 'members', 'Invite members to the society'),
  ('members.view.all', 'members', 'View all members and their contact details'),
  ('audit_log.view', 'audit', 'View the audit log'),
  ('platform.societies.create', 'platform', 'Create societies and their committee (super-admin only)'),
  ('platform.societies.manage', 'platform', 'Change society status, plan and quotas (super-admin only)');

create table public.job_run (
  id bigint generated always as identity primary key,
  society_id uuid,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error text
);
create index job_run_job_started_idx on public.job_run (job, started_at desc);
alter table public.job_run enable row level security;

-- Per-address log for the Send Email hook's rate limits. Service role only.
create table private.email_send_log (
  id bigint generated always as identity primary key,
  email text not null,
  action_type text not null,
  sent_at timestamptz not null default now()
);
create index email_send_log_email_sent_idx on private.email_send_log (email, sent_at desc);
create index email_send_log_sent_idx on private.email_send_log (sent_at desc);

-- ---------------------------------------------------------------------------
-- Tenant: society and usage
-- ---------------------------------------------------------------------------

create table public.society (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  registration_no text,
  address text,
  gstin text,
  -- onboarding: created by admin-onboard-society, not usable until the committee is set up
  status text not null default 'onboarding'
    check (status in ('onboarding', 'trial', 'active', 'suspended', 'closed')),
  plan text not null default 'pilot',
  trial_ends_at timestamptz,
  quotas jsonb not null default '{
    "max_flats": 300,
    "max_members": 1000,
    "emails_per_month": 5000,
    "whatsapp_per_month": 500,
    "sms_per_month": 0,
    "storage_mb": 2048,
    "invites_per_day": 100
  }'::jsonb,
  financial_year_start_month smallint not null default 4 check (financial_year_start_month between 1 and 12),
  timezone text not null default 'Asia/Kolkata',
  locked_until date,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index society_registration_no_key on public.society (registration_no)
  where registration_no is not null and deleted_at is null;
alter table public.society enable row level security;

create table public.society_usage (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  month date not null check (extract(day from month) = 1),
  emails_sent integer not null default 0,
  whatsapp_sent integer not null default 0,
  sms_sent integer not null default 0,
  storage_bytes bigint not null default 0,
  invites_sent integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, month),
  unique (society_id, id)
);
alter table public.society_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant: access
-- ---------------------------------------------------------------------------

create table public.membership (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  user_id uuid not null references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, user_id),
  unique (society_id, id)
);
create index membership_user_society_idx on public.membership (user_id, society_id);
alter table public.membership enable row level security;

create table public.role (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  name text not null check (length(trim(name)) between 1 and 60),
  is_system boolean not null default false,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, name),
  unique (society_id, id)
);
create index role_society_idx on public.role (society_id);
alter table public.role enable row level security;

create table public.membership_role (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null,
  membership_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (membership_id, role_id),
  unique (society_id, id),
  foreign key (society_id, membership_id) references public.membership (society_id, id),
  foreign key (society_id, role_id) references public.role (society_id, id)
);
create index membership_role_society_idx on public.membership_role (society_id);
create index membership_role_role_idx on public.membership_role (role_id);
alter table public.membership_role enable row level security;

create table public.invite (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  kind text not null default 'member' check (kind in ('member', 'committee')),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text,
  role_ids uuid[] not null default '{}',
  -- References flat(society_id, id) once the flat table exists (M4).
  flat_id uuid,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default now() + interval '7 days',
  -- When the invite was last created or resent; counts toward invites_per_day.
  last_sent_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id)
);
create unique index invite_one_pending_per_email on public.invite (society_id, email) where status = 'pending';
create index invite_email_pending_idx on public.invite (email) where status = 'pending';
create index invite_society_sent_idx on public.invite (society_id, last_sent_at);
alter table public.invite enable row level security;

-- ---------------------------------------------------------------------------
-- Role permissions must exist in the permission table, and never be platform keys
-- ---------------------------------------------------------------------------

create or replace function private.validate_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bad text;
begin
  select k into bad
  from unnest(new.permissions) as k
  where not exists (select 1 from public.permission p where p.key = k)
     or k like 'platform.%'
  limit 1;
  if bad is not null then
    raise exception 'invalid_permission: % is not a society permission', bad using errcode = '22023';
  end if;
  new.permissions := array(select distinct unnest(new.permissions) order by 1);
  return new;
end;
$$;

create trigger role_validate_permissions
  before insert or update of permissions on public.role
  for each row execute function private.validate_role_permissions();

-- ---------------------------------------------------------------------------
-- updated_at and audit triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'platform_config', 'society', 'society_usage',
                           'membership', 'role', 'membership_role', 'invite'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;

  foreach t in array array['profiles', 'platform_admin', 'platform_config', 'society', 'society_usage',
                           'membership', 'role', 'membership_role', 'invite'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
                   t || '_audit', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles follow auth.users
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text := lower(new.email);
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    user_email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), '')
  );

  if user_email is not null
     and exists (select 1 from private.platform_admin_email e where e.email = user_email) then
    insert into public.platform_admin (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();
