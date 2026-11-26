-- M1 row level security: helper functions, table privileges, policies and views.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can call them without
-- recursing through other tables' RLS). All read auth.uid() themselves.
-- ---------------------------------------------------------------------------

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admin pa where pa.user_id = (select auth.uid()));
$$;

create or replace function private.is_member(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership m
    where m.society_id = sid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.deleted_at is null
  );
$$;

create or replace function private.my_permissions(sid uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p order by p), '{}')
  from public.membership m
  join public.membership_role mr on mr.membership_id = m.id and mr.deleted_at is null
  join public.role r on r.id = mr.role_id and r.deleted_at is null
  cross join lateral unnest(r.permissions) as p
  where m.society_id = sid
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.deleted_at is null;
$$;

create or replace function private.has_permission(sid uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership m
    join public.membership_role mr on mr.membership_id = m.id and mr.deleted_at is null
    join public.role r on r.id = mr.role_id and r.deleted_at is null
    where m.society_id = sid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.deleted_at is null
      and perm = any (r.permissions)
  );
$$;

-- A society accepts writes only while it is active or in an unexpired trial.
create or replace function private.society_is_active(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.society s
    where s.id = sid
      and s.deleted_at is null
      and (s.status = 'active'
           or (s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now())))
  );
$$;

-- Stubs until the flat tables exist (M4 replaces both).
create or replace function private.my_flat_ids(sid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid where false and sid is not null;
$$;

create or replace function private.my_billable_flat_ids(sid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid where false and sid is not null;
$$;

-- True when the caller may see the target user's profile: themself, a platform
-- admin, or a holder of members.view.all in a society where the target is an active member.
create or replace function private.can_view_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = (select auth.uid())
      or private.is_platform_admin()
      or exists (
        select 1
        from public.membership m
        where m.user_id = target
          and m.status = 'active'
          and m.deleted_at is null
          and private.has_permission(m.society_id, 'members.view.all')
      );
$$;

revoke all on all functions in schema private from public, anon;
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

-- ---------------------------------------------------------------------------
-- Table privileges. Supabase grants everything to anon and authenticated by
-- default; take it all back and grant only what each table needs. RLS policies
-- then decide which rows.
-- ---------------------------------------------------------------------------

revoke all on public.audit_log, public.profiles, public.platform_admin, public.platform_config,
              public.permission, public.job_run, public.society, public.society_usage,
              public.membership, public.role, public.membership_role, public.invite
  from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant select on public.audit_log, public.profiles, public.platform_admin, public.platform_config,
                public.permission, public.job_run, public.society, public.society_usage,
                public.membership, public.role, public.membership_role, public.invite
  to authenticated;

-- Column-level update grants: everything else changes only through RPCs.
grant update (full_name, phone, whatsapp_opt_in, whatsapp_opt_in_at, avatar_key) on public.profiles to authenticated;
grant update (name, address) on public.society to authenticated;
grant update (sms_enabled, daily_email_cap, daily_sms_cap, email_per_address_hourly, email_per_address_daily)
  on public.platform_config to authenticated;

-- The audit log is append-only for everyone except the table owner.
revoke insert, update, delete, truncate on public.audit_log from service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- audit_log
create policy audit_log_select on public.audit_log for select to authenticated using (
  (society_id is not null and private.has_permission(society_id, 'audit_log.view'))
  or private.is_platform_admin()
);

-- profiles
create policy profiles_select on public.profiles for select to authenticated using (
  deleted_at is null and private.can_view_profile(id)
);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()));

-- platform tables
create policy platform_admin_select on public.platform_admin for select to authenticated using (
  user_id = (select auth.uid()) or private.is_platform_admin()
);
create policy platform_config_select on public.platform_config for select to authenticated using (
  private.is_platform_admin()
);
create policy platform_config_update on public.platform_config for update to authenticated
  using (private.is_platform_admin())
  with check (private.is_platform_admin());
create policy permission_select on public.permission for select to authenticated using (true);
create policy job_run_select on public.job_run for select to authenticated using (
  private.is_platform_admin()
);

-- society
create policy society_select on public.society for select to authenticated using (
  deleted_at is null and (private.is_member(id) or private.is_platform_admin())
);
create policy society_update on public.society for update to authenticated
  using (deleted_at is null and private.has_permission(id, 'society.update') and private.society_is_active(id))
  with check (private.has_permission(id, 'society.update') and private.society_is_active(id));

-- society_usage
create policy society_usage_select on public.society_usage for select to authenticated using (
  private.has_permission(society_id, 'society.view') or private.is_platform_admin()
);

-- membership
create policy membership_select on public.membership for select to authenticated using (
  deleted_at is null
  and (user_id = (select auth.uid())
       or private.has_permission(society_id, 'members.view.all')
       or private.is_platform_admin())
);

-- role
create policy role_select on public.role for select to authenticated using (
  deleted_at is null and (private.is_member(society_id) or private.is_platform_admin())
);

-- membership_role
create policy membership_role_select on public.membership_role for select to authenticated using (
  deleted_at is null
  and (private.has_permission(society_id, 'members.view.all')
       or private.is_platform_admin()
       or exists (
         select 1 from public.membership m
         where m.id = membership_id and m.user_id = (select auth.uid())
       ))
);

-- invite: committee members with members.invite see their society's invites.
-- Invitees see their own invites through my_pending_invites().
create policy invite_select on public.invite for select to authenticated using (
  deleted_at is null
  and (private.has_permission(society_id, 'members.invite') or private.is_platform_admin())
);

-- ---------------------------------------------------------------------------
-- Views (always security_invoker so the caller's RLS applies)
-- ---------------------------------------------------------------------------

create view public.my_memberships
with (security_invoker = true)
as
select
  m.id as membership_id,
  m.society_id,
  s.name as society_name,
  s.status as society_status,
  coalesce(array_agg(r.name order by r.name) filter (where r.id is not null), '{}') as role_names
from public.membership m
join public.society s on s.id = m.society_id and s.deleted_at is null
left join public.membership_role mr on mr.membership_id = m.id and mr.deleted_at is null
left join public.role r on r.id = mr.role_id and r.deleted_at is null
where m.user_id = (select auth.uid())
  and m.status = 'active'
  and m.deleted_at is null
group by m.id, m.society_id, s.name, s.status;

revoke all on public.my_memberships from anon, authenticated;
grant select on public.my_memberships to authenticated;
