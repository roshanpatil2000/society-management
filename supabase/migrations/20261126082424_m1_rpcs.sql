-- M1 RPCs: permissions, invites, platform admin actions, onboarding steps for the
-- admin-onboard-society Edge Function, Auth hooks support.
-- Every security definer function sets search_path = '' and checks permission first.
-- Errors use SQLSTATE 42501 for permission problems and P0001 with a short code
-- prefix (e.g. 'quota_exceeded: ...') for business rules.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function private.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(trim(p_email)), '');
$$;

create or replace function private.assert_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.normalize_email(p_email);
begin
  if v is null or v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email: %', coalesce(p_email, '(empty)') using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Caller may grant these roles only if each belongs to the society and the caller
-- already holds every permission the role carries.
create or replace function private.can_grant_roles(sid uuid, p_role_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_length(p_role_ids, 1), 0) > 0
     and array_position(p_role_ids, null) is null
     and (select count(*) from public.role r
          where r.id = any (p_role_ids) and r.society_id = sid and r.deleted_at is null)
         = (select count(distinct x) from unnest(p_role_ids) as x)
     and not exists (
       select 1
       from public.role r
       cross join lateral unnest(r.permissions) as p
       where r.id = any (p_role_ids)
         and not (p = any (private.my_permissions(sid)))
     );
$$;

create or replace function private.bump_usage(sid uuid, counter text, amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if counter not in ('emails_sent', 'whatsapp_sent', 'sms_sent', 'invites_sent') then
    raise exception 'unknown usage counter %', counter;
  end if;
  execute format(
    'insert into public.society_usage (society_id, month, %1$I) values ($1, $2, $3)
     on conflict (society_id, month) do update set %1$I = public.society_usage.%1$I + excluded.%1$I',
    counter)
  using sid, date_trunc('month', now() at time zone 'Asia/Kolkata')::date, amount;
end;
$$;

-- Marks pending invites past their expiry as expired.
create or replace function private.expire_invites(sid uuid, p_email text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invite
     set status = 'expired'
   where society_id = sid
     and status = 'pending'
     and expires_at <= now()
     and (p_email is null or email = p_email);
$$;

-- Refuses when another invite today would pass the society's invites_per_day quota.
-- Locks the society row so concurrent invites can't both slip under the limit.
create or replace function private.check_invite_quota(sid uuid, extra_members integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quotas jsonb;
  v_sent_today integer;
  v_people integer;
begin
  select s.quotas into v_quotas from public.society s where s.id = sid for update;

  select count(*) into v_sent_today
  from public.invite i
  where i.society_id = sid
    and (i.last_sent_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
  if v_sent_today >= coalesce((v_quotas ->> 'invites_per_day')::integer, 0) then
    raise exception 'quota_exceeded: invites_per_day' using errcode = 'P0001';
  end if;

  if extra_members > 0 then
    select (select count(*) from public.membership m
            where m.society_id = sid and m.status = 'active' and m.deleted_at is null)
         + (select count(*) from public.invite i
            where i.society_id = sid and i.status = 'pending' and i.expires_at > now())
      into v_people;
    if v_people + extra_members > coalesce((v_quotas ->> 'max_members')::integer, 0) then
      raise exception 'quota_exceeded: max_members' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- Turns an invite into an active membership with its roles. Caller must have
-- checked who may accept it.
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
  on conflict (membership_id, role_id) do nothing;

  update public.profiles
     set full_name = coalesce(full_name, p_invite.full_name)
   where id = p_user_id;

  update public.invite
     set status = 'accepted', accepted_by = p_user_id, accepted_at = now()
   where id = p_invite.id;

  return v_membership_id;
end;
$$;

-- Creates the society row and its starter roles. M2 replaces the two starter
-- roles with the full role presets from packages/shared.
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
  -- The insert uses the default quotas; merge any overrides on top.
  update public.society
     set quotas = quotas || coalesce(p_society -> 'quotas', '{}'::jsonb)
   where id = v_id;

  insert into public.role (society_id, name, is_system, permissions)
  values
    (v_id, 'Chairman', true,
     array(select p.key from public.permission p where p.key not like 'platform.%' order by p.key)),
    (v_id, 'Member', true, array['society.view']);

  return v_id;
end;
$$;

-- Creates committee invites for the given people. p_committee is a JSON array of
-- {"email", "full_name", "roles": ["Chairman", ...]} (role names in that society).
create or replace function private.create_committee_invites(sid uuid, p_committee jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person jsonb;
  v_email text;
  v_role_ids uuid[];
  v_role_names text[];
  v_invite public.invite;
  v_result jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
begin
  if jsonb_typeof(p_committee) is distinct from 'array' or jsonb_array_length(p_committee) = 0 then
    raise exception 'invalid_committee: at least one committee member is required' using errcode = '22023';
  end if;

  for person in select * from jsonb_array_elements(p_committee) loop
    v_email := private.assert_email(person ->> 'email');
    if v_email = any (v_seen) then
      raise exception 'invalid_committee: % is listed twice', v_email using errcode = '22023';
    end if;
    v_seen := v_seen || v_email;

    v_role_names := array(select jsonb_array_elements_text(coalesce(person -> 'roles', '[]'::jsonb)));
    if coalesce(array_length(v_role_names, 1), 0) = 0 then
      raise exception 'invalid_committee: % needs at least one role', v_email using errcode = '22023';
    end if;
    v_role_ids := array(
      select r.id from public.role r
      where r.society_id = sid and r.name = any (v_role_names) and r.deleted_at is null);
    if coalesce(array_length(v_role_ids, 1), 0) <> (select count(distinct n) from unnest(v_role_names) n) then
      raise exception 'invalid_committee: unknown role for %', v_email using errcode = '22023';
    end if;

    perform private.expire_invites(sid, v_email);
    update public.invite set status = 'revoked'
     where society_id = sid and email = v_email and status = 'pending';

    insert into public.invite (society_id, kind, email, full_name, role_ids, expires_at, created_by)
    values (sid, 'committee', v_email, nullif(trim(person ->> 'full_name'), ''), v_role_ids,
            now() + interval '1 day', p_actor)
    returning * into v_invite;

    v_result := v_result || jsonb_build_object(
      'invite_id', v_invite.id, 'email', v_invite.email, 'full_name', v_invite.full_name);
  end loop;

  return v_result;
end;
$$;

create or replace function private.assert_platform_admin(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (select 1 from public.platform_admin pa where pa.user_id = p_user_id) then
    raise exception 'permission_denied: platform admin only' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs for signed-in users
-- ---------------------------------------------------------------------------

create or replace function public.get_my_permissions(p_society_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_society_id) then
    raise exception 'permission_denied: not a member of this society' using errcode = '42501';
  end if;
  return private.my_permissions(p_society_id);
end;
$$;

create or replace function public.create_invite(
  p_society_id uuid,
  p_email text,
  p_role_ids uuid[],
  p_full_name text default null,
  p_flat_id uuid default null
)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_invite public.invite;
begin
  if not private.has_permission(p_society_id, 'members.invite') then
    raise exception 'permission_denied: members.invite' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  v_email := private.assert_email(p_email);
  if not private.can_grant_roles(p_society_id, p_role_ids) then
    raise exception 'permission_denied: cannot grant one or more of these roles' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.membership m join public.profiles pr on pr.id = m.user_id
    where m.society_id = p_society_id and m.status = 'active' and m.deleted_at is null and pr.email = v_email
  ) then
    raise exception 'already_member: % is already a member', v_email using errcode = 'P0001';
  end if;

  perform private.expire_invites(p_society_id, v_email);
  if exists (select 1 from public.invite i
             where i.society_id = p_society_id and i.email = v_email and i.status = 'pending') then
    raise exception 'already_invited: % has a pending invite; resend it instead', v_email using errcode = 'P0001';
  end if;

  perform private.check_invite_quota(p_society_id, 1);

  insert into public.invite (society_id, kind, email, full_name, role_ids, flat_id)
  values (p_society_id, 'member', v_email, nullif(trim(p_full_name), ''), p_role_ids, p_flat_id)
  returning * into v_invite;

  perform private.bump_usage(p_society_id, 'invites_sent', 1);
  return query select v_invite.id, v_invite.token, v_invite.expires_at;
end;
$$;

create or replace function public.resend_invite(p_invite_id uuid)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invite;
begin
  select * into v_invite from public.invite i where i.id = p_invite_id and i.deleted_at is null for update;
  if not found or not private.has_permission(v_invite.society_id, 'members.invite') then
    raise exception 'permission_denied: members.invite' using errcode = '42501';
  end if;
  if not private.society_is_active(v_invite.society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if v_invite.status not in ('pending', 'expired') then
    raise exception 'invite_not_pending: invite is %', v_invite.status using errcode = 'P0001';
  end if;
  if v_invite.status = 'expired' and exists (
    select 1 from public.invite i
    where i.society_id = v_invite.society_id and i.email = v_invite.email and i.status = 'pending'
  ) then
    raise exception 'already_invited: a newer invite is pending' using errcode = 'P0001';
  end if;

  perform private.check_invite_quota(v_invite.society_id, case when v_invite.status = 'expired' then 1 else 0 end);

  update public.invite i
     set token = encode(extensions.gen_random_bytes(24), 'hex'),
         expires_at = now() + interval '7 days',
         last_sent_at = now(),
         status = 'pending'
   where i.id = p_invite_id
  returning * into v_invite;

  perform private.bump_usage(v_invite.society_id, 'invites_sent', 1);
  return query select v_invite.id, v_invite.token, v_invite.expires_at;
end;
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invite;
begin
  select * into v_invite from public.invite i where i.id = p_invite_id and i.deleted_at is null for update;
  if not found or not private.has_permission(v_invite.society_id, 'members.invite') then
    raise exception 'permission_denied: members.invite' using errcode = '42501';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending: invite is %', v_invite.status using errcode = 'P0001';
  end if;
  update public.invite set status = 'revoked' where id = p_invite_id;
end;
$$;

-- Invites addressed to the signed-in user's email, so the app can offer them at login.
create or replace function public.my_pending_invites()
returns table (
  invite_id uuid,
  society_id uuid,
  society_name text,
  kind text,
  role_names text[],
  token text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.society_id, s.name, i.kind,
         array(select r.name from public.role r where r.id = any (i.role_ids) order by r.name),
         i.token, i.expires_at
  from public.invite i
  join public.society s on s.id = i.society_id and s.deleted_at is null and s.status in ('trial', 'active')
  join public.profiles pr on pr.id = (select auth.uid())
  where i.email = pr.email
    and i.status = 'pending'
    and i.expires_at > now()
    and i.deleted_at is null
  order by i.created_at;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invite;
  v_email text;
begin
  if v_uid is null then
    raise exception 'permission_denied: sign in first' using errcode = '42501';
  end if;
  select * into v_invite from public.invite i where i.token = p_token and i.deleted_at is null for update;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;
  select pr.email into v_email from public.profiles pr where pr.id = v_uid;
  if v_email is distinct from v_invite.email then
    raise exception 'permission_denied: this invite is for a different email' using errcode = '42501';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending: invite is %', v_invite.status using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    update public.invite set status = 'expired' where id = v_invite.id;
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if not private.society_is_active(v_invite.society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  return private.accept_invite_impl(v_invite, v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform admin RPCs (signed-in super-admin)
-- ---------------------------------------------------------------------------

create or replace function public.platform_set_society_status(
  p_society_id uuid,
  p_status text,
  p_trial_ends_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  perform private.assert_platform_admin((select auth.uid()));
  if p_status not in ('trial', 'active', 'suspended', 'closed') then
    raise exception 'invalid_status: %', p_status using errcode = '22023';
  end if;
  select s.status into v_current from public.society s where s.id = p_society_id and s.deleted_at is null for update;
  if not found then
    raise exception 'society_not_found' using errcode = 'P0001';
  end if;
  if v_current = 'onboarding' then
    raise exception 'invalid_status: society is still onboarding' using errcode = 'P0001';
  end if;
  update public.society
     set status = p_status,
         trial_ends_at = case when p_status = 'trial' then coalesce(p_trial_ends_at, trial_ends_at) else trial_ends_at end
   where id = p_society_id;
end;
$$;

create or replace function public.platform_set_quotas(
  p_society_id uuid,
  p_plan text default null,
  p_quotas jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  v_result jsonb;
begin
  perform private.assert_platform_admin((select auth.uid()));
  if jsonb_typeof(p_quotas) <> 'object' then
    raise exception 'invalid_quotas: expected an object' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_quotas) loop
    if k not in ('max_flats', 'max_members', 'emails_per_month', 'whatsapp_per_month',
                 'sms_per_month', 'storage_mb', 'invites_per_day') then
      raise exception 'invalid_quotas: unknown quota %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric <> trunc((v::text)::numeric) then
      raise exception 'invalid_quotas: % must be a whole number >= 0', k using errcode = '22023';
    end if;
  end loop;

  update public.society
     set quotas = quotas || p_quotas,
         plan = coalesce(nullif(trim(p_plan), ''), plan)
   where id = p_society_id and deleted_at is null
  returning quotas into v_result;
  if not found then
    raise exception 'society_not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role RPCs used by the admin-onboard-society Edge Function.
-- The function verifies the caller's JWT, then passes the admin's user id as
-- p_actor; each RPC checks it again and records it as the audit actor.
-- ---------------------------------------------------------------------------

create or replace function public.admin_onboard_begin(p_actor uuid, p_society jsonb, p_committee jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid;
begin
  perform private.assert_platform_admin(p_actor);
  perform set_config('app.actor', 'platform_admin:' || p_actor, true);
  v_sid := private.create_society_impl(p_society);
  update public.society set created_by = p_actor where id = v_sid;
  return jsonb_build_object(
    'society_id', v_sid,
    'invites', private.create_committee_invites(v_sid, p_committee, p_actor));
end;
$$;

create or replace function public.admin_add_committee_begin(p_actor uuid, p_society_id uuid, p_committee jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin(p_actor);
  perform set_config('app.actor', 'platform_admin:' || p_actor, true);
  if not exists (select 1 from public.society s
                 where s.id = p_society_id and s.deleted_at is null and s.status <> 'closed') then
    raise exception 'society_not_found' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'society_id', p_society_id,
    'invites', private.create_committee_invites(p_society_id, p_committee, p_actor));
end;
$$;

create or replace function public.admin_find_users(p_emails text[])
returns table (email text, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email), u.id
  from auth.users u
  where lower(u.email) = any (array(select lower(e) from unnest(p_emails) e));
$$;

-- p_accepts: JSON array of {"invite_id", "user_id"}. p_final_status ('trial' or
-- 'active') finishes onboarding a new society; null when adding committee members.
create or replace function public.admin_onboard_finish(
  p_actor uuid,
  p_society_id uuid,
  p_accepts jsonb,
  p_final_status text default null,
  p_trial_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_invite public.invite;
  v_user_email text;
  v_count integer := 0;
begin
  perform private.assert_platform_admin(p_actor);
  perform set_config('app.actor', 'platform_admin:' || p_actor, true);

  for item in select * from jsonb_array_elements(p_accepts) loop
    select * into v_invite from public.invite i
     where i.id = (item ->> 'invite_id')::uuid and i.society_id = p_society_id
       and i.kind = 'committee' and i.status = 'pending'
     for update;
    if not found then
      raise exception 'invite_not_pending: %', item ->> 'invite_id' using errcode = 'P0001';
    end if;
    select pr.email into v_user_email from public.profiles pr where pr.id = (item ->> 'user_id')::uuid;
    if v_user_email is distinct from v_invite.email then
      raise exception 'invalid_committee: user does not match invite %', v_invite.id using errcode = 'P0001';
    end if;
    perform private.accept_invite_impl(v_invite, (item ->> 'user_id')::uuid);
    v_count := v_count + 1;
  end loop;

  if p_final_status is not null then
    if p_final_status not in ('trial', 'active') then
      raise exception 'invalid_status: %', p_final_status using errcode = '22023';
    end if;
    update public.society
       set status = p_final_status,
           trial_ends_at = case when p_final_status = 'trial'
                                then coalesce(p_trial_ends_at, now() + interval '30 days') end
     where id = p_society_id and status = 'onboarding';
    if not found then
      raise exception 'invalid_status: society is not onboarding' using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('society_id', p_society_id, 'members_added', v_count);
end;
$$;

-- Compensating step when onboarding fails partway: revokes the given invites and,
-- if the society never finished onboarding, closes and soft-deletes it.
create or replace function public.admin_onboard_abort(p_actor uuid, p_society_id uuid, p_invite_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_platform_admin(p_actor);
  perform set_config('app.actor', 'platform_admin:' || p_actor, true);
  update public.invite set status = 'revoked'
   where society_id = p_society_id and id = any (p_invite_ids) and status = 'pending';
  update public.society set status = 'closed', deleted_at = now()
   where id = p_society_id and status = 'onboarding';
end;
$$;

-- ---------------------------------------------------------------------------
-- Send Email hook support (service role): allows the email only for known
-- addresses and within per-address and platform-wide limits, then logs it.
-- ---------------------------------------------------------------------------

create or replace function public.email_hook_check(p_email text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalize_email(p_email);
  v_cfg public.platform_config;
begin
  select * into v_cfg from public.platform_config where id;

  if v_email is null or not (
    exists (select 1 from auth.users u where lower(u.email) = v_email)
    or exists (select 1 from public.invite i where i.email = v_email and i.status = 'pending' and i.expires_at > now())
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_address');
  end if;

  if (select count(*) from private.email_send_log l where l.sent_at > now() - interval '1 day') >= v_cfg.daily_email_cap then
    return jsonb_build_object('allowed', false, 'reason', 'global_daily_cap');
  end if;
  if (select count(*) from private.email_send_log l
      where l.email = v_email and l.sent_at > now() - interval '1 hour') >= v_cfg.email_per_address_hourly then
    return jsonb_build_object('allowed', false, 'reason', 'address_hourly_limit');
  end if;
  if (select count(*) from private.email_send_log l
      where l.email = v_email and l.sent_at > now() - interval '1 day') >= v_cfg.email_per_address_daily then
    return jsonb_build_object('allowed', false, 'reason', 'address_daily_limit');
  end if;

  insert into private.email_send_log (email, action_type) values (v_email, coalesce(p_action, 'unknown'));
  return jsonb_build_object('allowed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Before User Created Auth hook: no self-registration. A new account is allowed
-- only for an email with a pending, unexpired invite, or a bootstrap super-admin
-- email. It does not trust the caller, so it covers email OTP, Google and the
-- admin API alike.
-- ---------------------------------------------------------------------------

create or replace function private.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalize_email(event -> 'user' ->> 'email');
begin
  if v_email is not null and (
    exists (
      select 1
      from public.invite i
      join public.society s on s.id = i.society_id and s.deleted_at is null and s.status <> 'closed'
      where i.email = v_email and i.status = 'pending' and i.expires_at > now() and i.deleted_at is null)
    or exists (select 1 from private.platform_admin_email e where e.email = v_email)
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email isn''t registered with any society. Ask your committee.'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_platform_admin(),
  private.is_member(uuid),
  private.my_permissions(uuid),
  private.has_permission(uuid, text),
  private.society_is_active(uuid),
  private.my_flat_ids(uuid),
  private.my_billable_flat_ids(uuid),
  private.can_view_profile(uuid)
to authenticated, service_role;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_before_user_created(jsonb) to supabase_auth_admin;

revoke all on function
  public.get_my_permissions(uuid),
  public.create_invite(uuid, text, uuid[], text, uuid),
  public.resend_invite(uuid),
  public.revoke_invite(uuid),
  public.my_pending_invites(),
  public.accept_invite(text),
  public.platform_set_society_status(uuid, text, timestamptz),
  public.platform_set_quotas(uuid, text, jsonb),
  public.admin_onboard_begin(uuid, jsonb, jsonb),
  public.admin_add_committee_begin(uuid, uuid, jsonb),
  public.admin_find_users(text[]),
  public.admin_onboard_finish(uuid, uuid, jsonb, text, timestamptz),
  public.admin_onboard_abort(uuid, uuid, uuid[]),
  public.email_hook_check(text, text)
from public, anon, authenticated;

grant execute on function
  public.get_my_permissions(uuid),
  public.create_invite(uuid, text, uuid[], text, uuid),
  public.resend_invite(uuid),
  public.revoke_invite(uuid),
  public.my_pending_invites(),
  public.accept_invite(text),
  public.platform_set_society_status(uuid, text, timestamptz),
  public.platform_set_quotas(uuid, text, jsonb)
to authenticated;

grant execute on function
  public.admin_onboard_begin(uuid, jsonb, jsonb),
  public.admin_add_committee_begin(uuid, uuid, jsonb),
  public.admin_find_users(text[]),
  public.admin_onboard_finish(uuid, uuid, jsonb, text, timestamptz),
  public.admin_onboard_abort(uuid, uuid, uuid[]),
  public.email_hook_check(text, text)
to service_role;
