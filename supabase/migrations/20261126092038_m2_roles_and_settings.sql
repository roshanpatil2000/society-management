-- M2: full Phase 1 permission keys, role presets, role RPCs, and maker-checker
-- for sensitive society settings. packages/shared is the source of truth for keys
-- and presets; the database sync test (pnpm --filter @society/shared test:db)
-- fails if this migration and packages/shared disagree.

-- ---------------------------------------------------------------------------
-- Permission keys
-- ---------------------------------------------------------------------------

insert into public.permission (key, module, description) values
  ('society.update_sensitive', 'society', 'Approve changes to sensitive settings (UPI ID, payee, limits, interest, GST, Razorpay)'),
  ('members.view.own', 'members', 'View own member record'),
  ('members.manage', 'members', 'Add, edit and remove members and occupants'),
  ('members.transfer', 'members', 'Approve flat transfers'),
  ('flats.view.all', 'flats', 'View all wings and flats'),
  ('flats.manage', 'flats', 'Create and edit wings and flats'),
  ('bills.view.own', 'bills', 'View bills of own flats'),
  ('bills.view.all', 'bills', 'View all bills'),
  ('bills.generate', 'bills', 'Create billing runs'),
  ('bills.approve', 'bills', 'Approve billing runs and credit notes'),
  ('bills.credit_note', 'bills', 'Request credit notes'),
  ('bills.resolve_dispute', 'bills', 'Resolve bill disputes'),
  ('bills.send', 'bills', 'Send approved bills to members'),
  ('charge_heads.manage', 'charge_heads', 'Create and edit charge heads'),
  ('payments.make.own', 'payments', 'Pay bills of own flats'),
  ('payments.record_offline', 'payments', 'Record cash and cheque payments'),
  ('payments.view.all', 'payments', 'View all payments'),
  ('payments.verify', 'payments', 'Verify or reject submitted payments'),
  ('payments.refund', 'payments', 'Request payment reversals and refunds'),
  ('expenses.view', 'expenses', 'View expenses'),
  ('expenses.create', 'expenses', 'Create expenses'),
  ('expenses.approve', 'expenses', 'Approve expenses'),
  ('expenses.pay', 'expenses', 'Pay approved expenses'),
  ('accounts.view', 'accounts', 'View ledgers and accounts'),
  ('accounts.manage', 'accounts', 'Manage ledger accounts and post bank lines'),
  ('accounts.opening_balance', 'accounts', 'Post opening balances'),
  ('accounts.close_year', 'accounts', 'Close a financial year'),
  ('reports.view', 'reports', 'View accounting reports'),
  ('dashboard.view', 'dashboard', 'View the transparency dashboard'),
  ('notices.view', 'notices', 'View notices'),
  ('notices.manage', 'notices', 'Publish and edit notices'),
  ('complaints.create', 'complaints', 'Raise complaints'),
  ('complaints.view.own', 'complaints', 'View own complaints'),
  ('complaints.view.assigned', 'complaints', 'View complaints assigned to me'),
  ('complaints.view.all', 'complaints', 'View all complaints'),
  ('complaints.assign', 'complaints', 'Assign complaints'),
  ('complaints.update_status', 'complaints', 'Update complaint status'),
  ('complaints.escalation.l1', 'complaints', 'Receive first-level complaint escalations'),
  ('complaints.escalation.l2', 'complaints', 'Receive second-level complaint escalations');

-- The module is always the part before the first dot (M1 seeded two differently).
update public.permission set module = split_part(key, '.', 1) where module <> split_part(key, '.', 1);

-- ---------------------------------------------------------------------------
-- Role presets (reference data, same as packages/shared/src/role-presets.ts)
-- ---------------------------------------------------------------------------

create table public.role_preset (
  name text primary key,
  sort_order smallint not null unique,
  description text not null,
  permissions text[] not null,
  updated_at timestamptz not null default now()
);
alter table public.role_preset enable row level security;
revoke all on public.role_preset from anon, authenticated;
grant select on public.role_preset to authenticated;
create policy role_preset_select on public.role_preset for select to authenticated using (true);
create trigger role_preset_audit after insert or update or delete on public.role_preset
  for each row execute function private.audit_row();

insert into public.role_preset (name, sort_order, description, permissions) values
  ('Chairman', 1, 'Every society permission',
   array(select key from public.permission where key not like 'platform.%' order by key)),
  ('Secretary', 2, 'Runs the society: settings, members, notices, billing (no bill approval), complaints', array[
    'society.view', 'society.update', 'roles.manage', 'members.invite',
    'flats.view.all', 'flats.manage', 'members.view.all', 'members.view.own', 'members.manage', 'members.transfer',
    'notices.view', 'notices.manage',
    'bills.view.own', 'bills.view.all', 'bills.generate', 'bills.credit_note', 'bills.resolve_dispute', 'bills.send',
    'charge_heads.manage',
    'complaints.create', 'complaints.view.own', 'complaints.view.assigned', 'complaints.view.all',
    'complaints.assign', 'complaints.update_status', 'complaints.escalation.l1',
    'dashboard.view', 'reports.view']),
  ('Treasurer', 3, 'Billing, payments, expenses (create and pay) and accounts', array[
    'society.view', 'notices.view',
    'bills.view.own', 'bills.view.all', 'bills.generate', 'bills.approve', 'bills.credit_note',
    'bills.resolve_dispute', 'bills.send', 'charge_heads.manage',
    'payments.make.own', 'payments.record_offline', 'payments.view.all', 'payments.verify', 'payments.refund',
    'expenses.view', 'expenses.create', 'expenses.pay',
    'accounts.view', 'accounts.manage', 'accounts.opening_balance', 'accounts.close_year',
    'reports.view', 'dashboard.view']),
  ('Committee member', 4, 'Views everything; approves expenses and bills, verifies payments, assigns complaints', array[
    'society.view', 'flats.view.all', 'members.view.all', 'bills.view.all', 'payments.view.all', 'expenses.view',
    'accounts.view', 'reports.view', 'dashboard.view', 'notices.view', 'complaints.view.all', 'audit_log.view',
    'expenses.approve', 'bills.approve', 'payments.verify', 'complaints.assign']),
  ('Member', 5, 'Flat owner: own bills and payments, complaints, notices, transparency dashboard', array[
    'bills.view.own', 'payments.make.own', 'members.view.own', 'complaints.create', 'complaints.view.own',
    'dashboard.view', 'expenses.view', 'notices.view']),
  ('Tenant', 6, 'Complaints and notices; own bills only where the owner allows it', array[
    'complaints.create', 'complaints.view.own', 'dashboard.view', 'notices.view', 'bills.view.own',
    'payments.make.own']),
  ('Staff', 7, 'Complaints assigned to them', array[
    'complaints.view.assigned', 'complaints.update_status', 'notices.view']),
  ('Auditor', 8, 'Read-only access to everything, including the audit log', array[
    'society.view', 'flats.view.all', 'members.view.all', 'bills.view.all', 'payments.view.all', 'expenses.view',
    'accounts.view', 'reports.view', 'dashboard.view', 'notices.view', 'complaints.view.all', 'audit_log.view']);

-- Presets may only name society permissions.
alter table public.role_preset add constraint role_preset_no_platform_keys
  check (not ('platform.societies.create' = any (permissions) or 'platform.societies.manage' = any (permissions)));

-- New societies get the presets instead of M1's two starter roles.
create or replace function private.create_society_roles(sid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.role (society_id, name, is_system, permissions)
  select sid, p.name, true, p.permissions
  from public.role_preset p
  on conflict (society_id, name) do update
    set permissions = excluded.permissions, is_system = true, deleted_at = null;
$$;

create or replace function private.create_society_impl(p_society jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(trim(p_society ->> 'name'), '');
begin
  if v_name is null then
    raise exception 'invalid_society: name is required' using errcode = '22023';
  end if;
  if nullif(trim(p_society ->> 'registration_no'), '') is not null and exists (
    select 1 from public.society s
    where s.registration_no = trim(p_society ->> 'registration_no') and s.deleted_at is null
  ) then
    raise exception 'duplicate_registration: a society with registration number % already exists',
      trim(p_society ->> 'registration_no') using errcode = 'P0001';
  end if;

  insert into public.society (name, registration_no, address, gstin, plan, financial_year_start_month)
  values (
    v_name,
    nullif(trim(p_society ->> 'registration_no'), ''),
    nullif(trim(p_society ->> 'address'), ''),
    nullif(upper(trim(p_society ->> 'gstin')), ''),
    coalesce(nullif(trim(p_society ->> 'plan'), ''), 'pilot'),
    coalesce((p_society ->> 'financial_year_start_month')::smallint, 4)
  )
  returning id into v_id;

  update public.society
     set quotas = quotas || coalesce(p_society -> 'quotas', '{}'::jsonb)
   where id = v_id;

  perform private.create_society_roles(v_id);
  return v_id;
end;
$$;

-- Bring societies created before M2 up to the presets.
do $$
declare
  sid uuid;
begin
  perform set_config('app.actor', 'migration:m2_roles', true);
  for sid in select id from public.society where deleted_at is null loop
    perform private.create_society_roles(sid);
  end loop;
end;
$$;

-- Re-accepting a role that was removed earlier restores it (role assignments are
-- soft-deleted, never hard-deleted).
create or replace function private.accept_invite_impl(p_invite public.invite, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  insert into public.membership (society_id, user_id, status)
  values (p_invite.society_id, p_user_id, 'active')
  on conflict (society_id, user_id)
    do update set status = 'active', deleted_at = null
  returning id into v_membership_id;

  insert into public.membership_role (society_id, membership_id, role_id)
  select p_invite.society_id, v_membership_id, r.id
  from public.role r
  where r.id = any (p_invite.role_ids)
    and r.society_id = p_invite.society_id
    and r.deleted_at is null
  on conflict (membership_id, role_id) do update set deleted_at = null;

  update public.profiles
     set full_name = coalesce(full_name, p_invite.full_name)
   where id = p_user_id;

  update public.invite
     set status = 'accepted', accepted_by = p_user_id, accepted_at = now()
   where id = p_invite.id;

  return v_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Role RPCs
-- ---------------------------------------------------------------------------

-- Every key exists in the permission table (22023 otherwise).
create or replace function private.assert_permission_keys(p_keys text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bad text;
begin
  if array_position(p_keys, null) is not null then
    raise exception 'invalid_permission: empty permission key' using errcode = '22023';
  end if;
  select k into bad from unnest(p_keys) k
  where not exists (select 1 from public.permission p where p.key = k) limit 1;
  if bad is not null then
    raise exception 'invalid_permission: % is not a permission', bad using errcode = '22023';
  end if;
end;
$$;

-- The caller holds every one of these keys in the society (42501 otherwise).
create or replace function private.assert_holds_all(sid uuid, p_keys text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  missing text;
begin
  select k into missing from unnest(p_keys) k
  where not (k = any (private.my_permissions(sid))) limit 1;
  if missing is not null then
    raise exception 'permission_denied: you do not hold %', missing using errcode = '42501';
  end if;
end;
$$;

-- After a role change, someone active must still hold roles.manage.
create or replace function private.assert_roles_manage_remains(sid uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.membership m
    join public.membership_role mr on mr.membership_id = m.id and mr.deleted_at is null
    join public.role r on r.id = mr.role_id and r.deleted_at is null
    where m.society_id = sid and m.status = 'active' and m.deleted_at is null
      and 'roles.manage' = any (r.permissions)
  ) then
    raise exception 'lockout: this would leave nobody who can manage roles' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.create_role(p_society_id uuid, p_name text, p_permissions text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_id uuid;
begin
  if not private.has_permission(p_society_id, 'roles.manage') then
    raise exception 'permission_denied: roles.manage' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if v_name is null or length(v_name) > 60 then
    raise exception 'invalid_role: name must be 1 to 60 characters' using errcode = '22023';
  end if;
  perform private.assert_permission_keys(coalesce(p_permissions, '{}'));
  perform private.assert_holds_all(p_society_id, coalesce(p_permissions, '{}'));
  if exists (select 1 from public.role r
             where r.society_id = p_society_id and r.name = v_name and r.deleted_at is null) then
    raise exception 'duplicate_role: % already exists', v_name using errcode = 'P0001';
  end if;

  insert into public.role (society_id, name, is_system, permissions)
  values (p_society_id, v_name, false, coalesce(p_permissions, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

-- Rename a custom role and/or replace a role's permissions. The caller must hold
-- every permission the role has now and every one it will have.
create or replace function public.update_role(p_role_id uuid, p_name text default null, p_permissions text[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.role;
  v_name text := nullif(trim(p_name), '');
begin
  select * into v_role from public.role r where r.id = p_role_id and r.deleted_at is null for update;
  if not found or not private.has_permission(v_role.society_id, 'roles.manage') then
    raise exception 'permission_denied: roles.manage' using errcode = '42501';
  end if;
  if not private.society_is_active(v_role.society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  perform private.assert_holds_all(v_role.society_id, v_role.permissions);

  if v_name is not null and v_name <> v_role.name then
    if v_role.is_system then
      raise exception 'invalid_role: system roles cannot be renamed' using errcode = 'P0001';
    end if;
    if length(v_name) > 60 then
      raise exception 'invalid_role: name must be 1 to 60 characters' using errcode = '22023';
    end if;
    if exists (select 1 from public.role r
               where r.society_id = v_role.society_id and r.name = v_name and r.deleted_at is null) then
      raise exception 'duplicate_role: % already exists', v_name using errcode = 'P0001';
    end if;
  end if;

  if p_permissions is not null then
    perform private.assert_permission_keys(p_permissions);
    perform private.assert_holds_all(v_role.society_id, p_permissions);
  end if;

  update public.role
     set name = coalesce(v_name, name),
         permissions = coalesce(p_permissions, permissions)
   where id = p_role_id;

  perform private.assert_roles_manage_remains(v_role.society_id);
end;
$$;

-- Set a member's roles to exactly p_role_ids. The caller must be able to grant
-- every role being added and every role being taken away.
create or replace function public.assign_roles(p_membership_id uuid, p_role_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.membership;
  v_current uuid[];
  v_target uuid[] := coalesce(p_role_ids, '{}');
  v_added uuid[];
  v_removed uuid[];
begin
  select * into v_membership from public.membership m
   where m.id = p_membership_id and m.deleted_at is null for update;
  if not found or not private.has_permission(v_membership.society_id, 'roles.manage') then
    raise exception 'permission_denied: roles.manage' using errcode = '42501';
  end if;
  if not private.society_is_active(v_membership.society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'invalid_membership: member has been removed' using errcode = 'P0001';
  end if;
  if array_position(v_target, null) is not null or exists (
    select 1 from unnest(v_target) x
    where not exists (select 1 from public.role r
                      where r.id = x and r.society_id = v_membership.society_id and r.deleted_at is null)
  ) then
    raise exception 'permission_denied: role does not belong to this society' using errcode = '42501';
  end if;

  v_current := array(select mr.role_id from public.membership_role mr
                      where mr.membership_id = p_membership_id and mr.deleted_at is null);
  v_added := array(select x from unnest(v_target) x except select y from unnest(v_current) y);
  v_removed := array(select y from unnest(v_current) y except select x from unnest(v_target) x);

  perform private.assert_holds_all(v_membership.society_id, array(
    select distinct p from public.role r cross join lateral unnest(r.permissions) p
    where r.id = any (v_added || v_removed)));

  update public.membership_role
     set deleted_at = now()
   where membership_id = p_membership_id and role_id = any (v_removed) and deleted_at is null;

  insert into public.membership_role (society_id, membership_id, role_id)
  select v_membership.society_id, p_membership_id, x from unnest(v_added) x
  on conflict (membership_id, role_id) do update set deleted_at = null;

  perform private.assert_roles_manage_remains(v_membership.society_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Society settings: sensitive keys need a second person; others change directly
-- ---------------------------------------------------------------------------

create table public.setting_change (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  check (approved_by is null or approved_by <> requested_by)
);
create unique index setting_change_one_pending on public.setting_change (society_id, key) where status = 'pending';
create index setting_change_society_idx on public.setting_change (society_id, created_at desc);
alter table public.setting_change enable row level security;
revoke all on public.setting_change from anon, authenticated;
grant select on public.setting_change to authenticated;
create policy setting_change_select on public.setting_change for select to authenticated using (
  deleted_at is null
  and (private.has_permission(society_id, 'society.update')
       or private.has_permission(society_id, 'society.update_sensitive')
       or private.is_platform_admin())
);
create trigger setting_change_set_updated_at before update on public.setting_change
  for each row execute function private.set_updated_at();
create trigger setting_change_audit after insert or update or delete on public.setting_change
  for each row execute function private.audit_row();

-- Validates and normalises one setting value. Sensitive keys need approval;
-- billing_cycle is the only setting that changes directly.
create or replace function private.normalize_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := jsonb_typeof(p_value);
  n numeric;
begin
  case p_key
    when 'upi_id' then
      if t <> 'string' or (p_value #>> '{}') !~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$' then
        raise exception 'invalid_setting: upi_id must look like name@bank' using errcode = '22023';
      end if;
      return to_jsonb(lower(p_value #>> '{}'));
    when 'payee_name' then
      if t <> 'string' or length(trim(p_value #>> '{}')) not between 2 and 100 then
        raise exception 'invalid_setting: payee_name must be 2 to 100 characters' using errcode = '22023';
      end if;
      return to_jsonb(trim(p_value #>> '{}'));
    when 'approval_limit' then
      if t <> 'number' then
        raise exception 'invalid_setting: approval_limit must be a whole number of paise' using errcode = '22023';
      end if;
      n := (p_value #>> '{}')::numeric;
      if n <> trunc(n) or n < 0 or n > 1000000000000 then
        raise exception 'invalid_setting: approval_limit must be a whole number of paise' using errcode = '22023';
      end if;
      return to_jsonb(n::bigint);
    when 'interest_rate' then
      if t <> 'number' then
        raise exception 'invalid_setting: interest_rate is a yearly percentage' using errcode = '22023';
      end if;
      n := (p_value #>> '{}')::numeric;
      if n < 0 or n > 21 or n <> round(n, 2) then
        raise exception 'invalid_setting: interest_rate must be 0 to 21 (%% a year), at most 2 decimals' using errcode = '22023';
      end if;
      return to_jsonb(n);
    when 'grace_days' then
      if t <> 'number' then
        raise exception 'invalid_setting: grace_days must be 0 to 90' using errcode = '22023';
      end if;
      n := (p_value #>> '{}')::numeric;
      if n <> trunc(n) or n < 0 or n > 90 then
        raise exception 'invalid_setting: grace_days must be 0 to 90' using errcode = '22023';
      end if;
      return to_jsonb(n::int);
    when 'gst_enabled', 'razorpay_enabled' then
      if t <> 'boolean' then
        raise exception 'invalid_setting: % must be true or false', p_key using errcode = '22023';
      end if;
      return p_value;
    when 'rounding' then
      if t <> 'string' or (p_value #>> '{}') not in ('line_nearest_rupee', 'none') then
        raise exception 'invalid_setting: rounding must be line_nearest_rupee or none' using errcode = '22023';
      end if;
      return p_value;
    when 'billing_cycle' then
      if t <> 'string' or (p_value #>> '{}') not in ('monthly', 'quarterly') then
        raise exception 'invalid_setting: billing_cycle must be monthly or quarterly' using errcode = '22023';
      end if;
      return p_value;
    else
      raise exception 'invalid_setting: unknown setting %', p_key using errcode = '22023';
  end case;
end;
$$;

create or replace function private.is_sensitive_setting(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key in ('upi_id', 'payee_name', 'approval_limit', 'interest_rate', 'grace_days',
                   'gst_enabled', 'razorpay_enabled', 'rounding');
$$;

create or replace function public.request_setting_change(p_society_id uuid, p_key text, p_value jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
  v_id uuid;
begin
  if not private.has_permission(p_society_id, 'society.update') then
    raise exception 'permission_denied: society.update' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if not private.is_sensitive_setting(p_key) then
    raise exception 'invalid_setting: % is not a sensitive setting; change it directly', p_key using errcode = '22023';
  end if;
  v_value := private.normalize_setting(p_key, p_value);
  if exists (select 1 from public.setting_change c
             where c.society_id = p_society_id and c.key = p_key and c.status = 'pending') then
    raise exception 'already_pending: a change to % is waiting for approval', p_key using errcode = 'P0001';
  end if;

  insert into public.setting_change (society_id, key, old_value, new_value, requested_by)
  select p_society_id, p_key, s.settings -> p_key, v_value, (select auth.uid())
  from public.society s where s.id = p_society_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.approve_setting_change(p_change_id uuid, p_decision text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change public.setting_change;
  v_uid uuid := (select auth.uid());
begin
  select * into v_change from public.setting_change c where c.id = p_change_id and c.deleted_at is null for update;
  if not found or not private.has_permission(v_change.society_id, 'society.update_sensitive') then
    raise exception 'permission_denied: society.update_sensitive' using errcode = '42501';
  end if;
  if not private.society_is_active(v_change.society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if v_change.status <> 'pending' then
    raise exception 'not_pending: this change was already %', v_change.status using errcode = 'P0001';
  end if;
  if v_change.requested_by = v_uid then
    raise exception 'permission_denied: you cannot approve your own change' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision: use approve or reject' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    update public.society
       set settings = settings || jsonb_build_object(v_change.key, v_change.new_value)
     where id = v_change.society_id;
  end if;

  update public.setting_change
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         approved_by = v_uid,
         decided_at = now(),
         decision_comment = nullif(trim(p_comment), '')
   where id = p_change_id;
end;
$$;

-- Non-sensitive settings (billing_cycle) change directly with society.update.
create or replace function public.update_society_settings(p_society_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if not private.has_permission(p_society_id, 'society.update') then
    raise exception 'permission_denied: society.update' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid_setting: expected an object' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_settings) loop
    if private.is_sensitive_setting(k) then
      raise exception 'permission_denied: % is sensitive and needs a second person''s approval', k using errcode = '42501';
    end if;
    v_clean := v_clean || jsonb_build_object(k, private.normalize_setting(k, v));
  end loop;

  update public.society set settings = settings || v_clean where id = p_society_id
  returning settings into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function
  private.create_society_roles(uuid),
  private.assert_permission_keys(text[]),
  private.assert_holds_all(uuid, text[]),
  private.assert_roles_manage_remains(uuid),
  private.normalize_setting(text, jsonb),
  private.is_sensitive_setting(text)
from public, anon, authenticated;

revoke all on function
  public.create_role(uuid, text, text[]),
  public.update_role(uuid, text, text[]),
  public.assign_roles(uuid, uuid[]),
  public.request_setting_change(uuid, text, jsonb),
  public.approve_setting_change(uuid, text, text),
  public.update_society_settings(uuid, jsonb)
from public, anon;

grant execute on function
  public.create_role(uuid, text, text[]),
  public.update_role(uuid, text, text[]),
  public.assign_roles(uuid, uuid[]),
  public.request_setting_change(uuid, text, jsonb),
  public.approve_setting_change(uuid, text, text),
  public.update_society_settings(uuid, jsonb)
to authenticated;
