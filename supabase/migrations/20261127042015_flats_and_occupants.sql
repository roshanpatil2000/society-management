-- Wings, flats and occupants. The committee manages them (flats.manage,
-- members.manage); members see only their own flat; tenants reach billing only
-- when the owner allows it (can_view_bills). Dues belong to the flat, not the person.

create table public.wing (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  name text not null check (length(trim(name)) between 1 and 40),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id)
);
create unique index wing_name_key on public.wing (society_id, name) where deleted_at is null;
alter table public.wing enable row level security;

create table public.flat (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null,
  wing_id uuid not null,
  number text not null check (length(trim(number)) between 1 and 20),
  floor smallint,
  area_sqft numeric(10, 2) check (area_sqft > 0),
  flat_type text check (flat_type is null or length(trim(flat_type)) between 1 and 30),
  parking_slot text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, wing_id) references public.wing (society_id, id)
);
create unique index flat_number_key on public.flat (society_id, wing_id, number) where deleted_at is null;
create index flat_society_idx on public.flat (society_id);
alter table public.flat enable row level security;

create table public.flat_occupant (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null,
  flat_id uuid not null,
  user_id uuid not null references public.profiles (id),
  type text not null check (type in ('owner', 'joint_owner', 'tenant')),
  share_cert_no text,
  from_date date not null default current_date,
  to_date date,
  can_view_bills boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, flat_id) references public.flat (society_id, id),
  check (to_date is null or to_date >= from_date)
);
create unique index flat_occupant_open_key on public.flat_occupant (flat_id, user_id)
  where to_date is null and deleted_at is null;
create index flat_occupant_user_idx on public.flat_occupant (user_id, society_id) where deleted_at is null;
create index flat_occupant_flat_idx on public.flat_occupant (flat_id) where deleted_at is null;
alter table public.flat_occupant enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['wing', 'flat', 'flat_occupant'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_set_updated_at', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
                   t || '_audit', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Flat quota: max_flats from society.quotas
-- ---------------------------------------------------------------------------

create or replace function private.enforce_flat_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  select (s.quotas ->> 'max_flats')::integer into v_max from public.society s where s.id = new.society_id for update;
  if (select count(*) from public.flat f where f.society_id = new.society_id and f.deleted_at is null) >= coalesce(v_max, 0) then
    raise exception 'quota_exceeded: max_flats' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger flat_enforce_quota before insert on public.flat
  for each row execute function private.enforce_flat_quota();

-- ---------------------------------------------------------------------------
-- The real my_flat_ids / my_billable_flat_ids (stubs until now)
-- ---------------------------------------------------------------------------

create or replace function private.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Flats the signed-in person currently owns or rents in the society.
create or replace function private.my_flat_ids(sid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct o.flat_id
  from public.flat_occupant o
  where o.society_id = sid
    and o.user_id = (select auth.uid())
    and o.deleted_at is null
    and o.from_date <= private.today_ist()
    and (o.to_date is null or o.to_date >= private.today_ist());
$$;

-- Like my_flat_ids, but a tenant's flat counts only when the owner allowed it.
create or replace function private.my_billable_flat_ids(sid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct o.flat_id
  from public.flat_occupant o
  where o.society_id = sid
    and o.user_id = (select auth.uid())
    and o.deleted_at is null
    and o.from_date <= private.today_ist()
    and (o.to_date is null or o.to_date >= private.today_ist())
    and (o.type in ('owner', 'joint_owner') or o.can_view_bills);
$$;

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------

revoke all on public.wing, public.flat, public.flat_occupant from anon, authenticated;
grant select on public.wing, public.flat, public.flat_occupant to authenticated;
grant insert (society_id, name, sort_order) on public.wing to authenticated;
grant update (name, sort_order, deleted_at) on public.wing to authenticated;
grant insert (society_id, wing_id, number, floor, area_sqft, flat_type, parking_slot) on public.flat to authenticated;
grant update (wing_id, number, floor, area_sqft, flat_type, parking_slot, deleted_at) on public.flat to authenticated;
grant insert (society_id, flat_id, user_id, type, share_cert_no, from_date, to_date, can_view_bills)
  on public.flat_occupant to authenticated;
grant update (type, share_cert_no, from_date, to_date, can_view_bills, deleted_at) on public.flat_occupant to authenticated;

create policy wing_select on public.wing for select to authenticated using (
  private.is_member(society_id) or private.is_platform_admin()
);
create policy wing_insert on public.wing for insert to authenticated with check (
  private.has_permission(society_id, 'flats.manage') and private.society_is_active(society_id)
);
create policy wing_update on public.wing for update to authenticated
  using (private.has_permission(society_id, 'flats.manage') and private.society_is_active(society_id))
  with check (private.has_permission(society_id, 'flats.manage') and private.society_is_active(society_id));

create policy flat_select on public.flat for select to authenticated using (
  private.has_permission(society_id, 'flats.view.all')
  or id in (select private.my_flat_ids(society_id))
  or private.is_platform_admin()
);
create policy flat_insert on public.flat for insert to authenticated with check (
  private.has_permission(society_id, 'flats.manage') and private.society_is_active(society_id)
);
create policy flat_update on public.flat for update to authenticated
  using (private.has_permission(society_id, 'flats.manage') and private.society_is_active(society_id))
  with check (private.has_permission(society_id, 'flats.manage') and private.society_is_active(society_id));

create policy flat_occupant_select on public.flat_occupant for select to authenticated using (
  private.has_permission(society_id, 'members.view.all')
  or flat_id in (select private.my_flat_ids(society_id))
  or private.is_platform_admin()
);
create policy flat_occupant_insert on public.flat_occupant for insert to authenticated with check (
  private.has_permission(society_id, 'members.manage') and private.society_is_active(society_id)
);
create policy flat_occupant_update on public.flat_occupant for update to authenticated
  using (private.has_permission(society_id, 'members.manage') and private.society_is_active(society_id))
  with check (private.has_permission(society_id, 'members.manage') and private.society_is_active(society_id));

-- ---------------------------------------------------------------------------
-- Invites can name a flat and the person's role in it
-- ---------------------------------------------------------------------------

alter table public.invite
  add column occupant_type text check (occupant_type is null or occupant_type in ('owner', 'joint_owner', 'tenant')),
  add constraint invite_flat_fkey foreign key (society_id, flat_id) references public.flat (society_id, id);

drop function public.create_invite(uuid, text, uuid[], text, uuid);

create or replace function public.create_invite(
  p_society_id uuid,
  p_email text,
  p_role_ids uuid[],
  p_full_name text default null,
  p_flat_id uuid default null,
  p_occupant_type text default null
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
  if p_flat_id is not null and not exists (
    select 1 from public.flat f where f.id = p_flat_id and f.society_id = p_society_id and f.deleted_at is null
  ) then
    raise exception 'permission_denied: flat does not belong to this society' using errcode = '42501';
  end if;
  if p_occupant_type is not null and p_occupant_type not in ('owner', 'joint_owner', 'tenant') then
    raise exception 'invalid_invite: occupant type must be owner, joint_owner or tenant' using errcode = '22023';
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

  insert into public.invite (society_id, kind, email, full_name, role_ids, flat_id, occupant_type)
  values (p_society_id, 'member', v_email, nullif(trim(p_full_name), ''), p_role_ids, p_flat_id,
          case when p_flat_id is not null then coalesce(p_occupant_type, 'owner') end)
  returning * into v_invite;

  perform private.bump_usage(p_society_id, 'invites_sent', 1);
  return query select v_invite.id, v_invite.token, v_invite.expires_at;
end;
$$;

revoke all on function public.create_invite(uuid, text, uuid[], text, uuid, text) from public, anon;
grant execute on function public.create_invite(uuid, text, uuid[], text, uuid, text) to authenticated;

-- Accepting an invite that names a flat records the person as its occupant.
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

  if p_invite.flat_id is not null and not exists (
    select 1 from public.flat_occupant o
    where o.flat_id = p_invite.flat_id and o.user_id = p_user_id and o.to_date is null and o.deleted_at is null
  ) then
    insert into public.flat_occupant (society_id, flat_id, user_id, type)
    values (p_invite.society_id, p_invite.flat_id, p_user_id, coalesce(p_invite.occupant_type, 'owner'));
  end if;

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
-- Member directory: names and flats of the society's active members, for every
-- member. No email or phone (those need members.view.all).
-- ---------------------------------------------------------------------------

create or replace function public.member_directory(p_society_id uuid)
returns table (user_id uuid, full_name text, flats text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_society_id) then
    raise exception 'permission_denied: not a member of this society' using errcode = '42501';
  end if;
  return query
  select m.user_id,
         pr.full_name,
         coalesce(array(
           select w.name || '-' || f.number
           from public.flat_occupant o
           join public.flat f on f.id = o.flat_id and f.deleted_at is null
           join public.wing w on w.id = f.wing_id
           where o.society_id = p_society_id and o.user_id = m.user_id and o.deleted_at is null
             and o.from_date <= private.today_ist()
             and (o.to_date is null or o.to_date >= private.today_ist())
           order by 1), '{}')
  from public.membership m
  join public.profiles pr on pr.id = m.user_id
  where m.society_id = p_society_id and m.status = 'active' and m.deleted_at is null
  order by pr.full_name;
end;
$$;

revoke all on function public.member_directory(uuid) from public, anon;
grant execute on function public.member_directory(uuid) to authenticated;

revoke all on function private.enforce_flat_quota(), private.today_ist() from public, anon, authenticated;
grant execute on function private.today_ist() to authenticated, service_role;
