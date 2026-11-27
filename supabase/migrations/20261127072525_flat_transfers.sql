-- Flat transfers and occupancy expiry.
--
-- A committee member with members.manage requests a transfer (sellers, buyers,
-- date, share certificate, transfer fee); a different member with
-- members.transfer approves or rejects it. Approval closes the sellers'
-- occupancy the day before the transfer date, makes buyers who are already
-- members owners from that date, invites the rest for that flat, and removes
-- memberships left with no flat and no committee role. Dues stay with the flat.
-- A nightly job does the same membership cleanup when occupancies end.
-- The transfer fee is recorded here; it is billed by the billing run.

create table public.flat_transfer (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.society (id),
  flat_id uuid not null,
  from_occupant_ids uuid[] not null default '{}',
  -- [{email, full_name?, type: owner|joint_owner}]
  buyers jsonb not null check (jsonb_typeof(buyers) = 'array' and jsonb_array_length(buyers) between 1 and 10),
  transfer_date date not null,
  share_cert_no text check (share_cert_no is null or length(trim(share_cert_no)) between 1 and 40),
  transfer_fee bigint not null default 0 check (transfer_fee >= 0),
  note text check (note is null or length(note) <= 500),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (society_id, id),
  foreign key (society_id, flat_id) references public.flat (society_id, id)
);
create unique index flat_transfer_one_open on public.flat_transfer (flat_id) where status = 'requested' and deleted_at is null;
create index flat_transfer_society_idx on public.flat_transfer (society_id, status);
alter table public.flat_transfer enable row level security;

create trigger flat_transfer_set_updated_at before update on public.flat_transfer
  for each row execute function private.set_updated_at();
create trigger flat_transfer_audit after insert or update or delete on public.flat_transfer
  for each row execute function private.audit_row();

revoke all on public.flat_transfer from anon, authenticated;
grant select on public.flat_transfer to authenticated;
create policy flat_transfer_select on public.flat_transfer for select to authenticated using (
  private.has_permission(society_id, 'members.manage')
  or private.has_permission(society_id, 'members.transfer')
  or private.has_permission(society_id, 'members.view.all')
  or private.is_platform_admin()
);

-- ---------------------------------------------------------------------------
-- Membership cleanup: a person with no current or future flat in the society
-- and only resident roles (Member, Tenant) stops being a member.
-- ---------------------------------------------------------------------------

create or replace function private.remove_if_left_with_nothing(p_society_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.flat_occupant o
    where o.society_id = p_society_id and o.user_id = p_user_id and o.deleted_at is null
      and (o.to_date is null or o.to_date >= private.today_ist())
  ) then
    return false;
  end if;
  -- Any role granting a non-resident permission keeps the membership.
  if exists (
    select 1
    from public.membership m
    join public.membership_role mr on mr.membership_id = m.id and mr.deleted_at is null
    join public.role r on r.id = mr.role_id and r.deleted_at is null
    join public.permission p on p.key = any (r.permissions)
    where m.society_id = p_society_id and m.user_id = p_user_id and not p.resident
  ) then
    return false;
  end if;
  update public.membership m
     set status = 'removed'
   where m.society_id = p_society_id and m.user_id = p_user_id and m.status = 'active';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request
-- ---------------------------------------------------------------------------

create or replace function public.request_flat_transfer(
  p_society_id uuid,
  p_flat_id uuid,
  p_from_occupant_ids uuid[],
  p_buyers jsonb,
  p_transfer_date date,
  p_share_cert_no text default null,
  p_transfer_fee bigint default 0,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyers jsonb := '[]'::jsonb;
  b jsonb;
  v_email text;
  v_id uuid;
begin
  if not private.has_permission(p_society_id, 'members.manage') then
    raise exception 'permission_denied: members.manage' using errcode = '42501';
  end if;
  if not private.society_is_active(p_society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.flat f where f.id = p_flat_id and f.society_id = p_society_id and f.deleted_at is null) then
    raise exception 'permission_denied: flat does not belong to this society' using errcode = '42501';
  end if;
  if p_transfer_date is null then
    raise exception 'invalid_transfer: the transfer date is required' using errcode = '22023';
  end if;
  if coalesce(p_transfer_fee, 0) < 0 then
    raise exception 'invalid_transfer: the transfer fee cannot be negative' using errcode = '22023';
  end if;
  if exists (select 1 from public.flat_transfer t
             where t.flat_id = p_flat_id and t.status = 'requested' and t.deleted_at is null) then
    raise exception 'transfer_pending: this flat already has a transfer waiting for approval' using errcode = 'P0001';
  end if;

  -- Sellers: current owners or joint owners of this flat who moved in before the transfer.
  if exists (
    select 1 from unnest(coalesce(p_from_occupant_ids, '{}')) x(id)
    where not exists (
      select 1 from public.flat_occupant o
      where o.id = x.id and o.flat_id = p_flat_id and o.society_id = p_society_id and o.deleted_at is null
        and o.type in ('owner', 'joint_owner') and o.to_date is null and o.from_date < p_transfer_date)
  ) then
    raise exception 'invalid_transfer: sellers must be current owners of this flat who moved in before the transfer date'
      using errcode = '22023';
  end if;

  -- Buyers: valid emails, owner or joint owner, at least one owner.
  if jsonb_typeof(p_buyers) is distinct from 'array' or jsonb_array_length(p_buyers) not between 1 and 10 then
    raise exception 'invalid_transfer: list one to ten buyers' using errcode = '22023';
  end if;
  for b in select * from jsonb_array_elements(p_buyers) loop
    if coalesce(b ->> 'type', '') not in ('owner', 'joint_owner') then
      raise exception 'invalid_transfer: buyers are owners or joint owners' using errcode = '22023';
    end if;
    v_email := private.assert_email(b ->> 'email');
    if v_buyers @> jsonb_build_array(jsonb_build_object('email', v_email)) then
      raise exception 'invalid_transfer: % is listed twice', v_email using errcode = '22023';
    end if;
    v_buyers := v_buyers || jsonb_build_object('email', v_email, 'full_name', nullif(trim(b ->> 'full_name'), ''),
                                               'type', b ->> 'type');
  end loop;
  if not v_buyers @> '[{"type": "owner"}]' then
    raise exception 'invalid_transfer: at least one buyer must be an owner' using errcode = '22023';
  end if;

  insert into public.flat_transfer (society_id, flat_id, from_occupant_ids, buyers, transfer_date, share_cert_no,
                                    transfer_fee, note, requested_by)
  values (p_society_id, p_flat_id, coalesce(p_from_occupant_ids, '{}'), v_buyers, p_transfer_date,
          nullif(trim(p_share_cert_no), ''), coalesce(p_transfer_fee, 0), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve or reject (maker-checker)
-- ---------------------------------------------------------------------------

create or replace function private.approve_flat_transfer_impl(p_transfer public.flat_transfer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer := 0;
  v_added integer := 0;
  v_invited integer := 0;
  v_removed integer := 0;
  v_member_role uuid;
  v_seller uuid;
  v_user uuid;
  b jsonb;
begin
  -- 1. Sellers leave the day before the transfer.
  with closed as (
    update public.flat_occupant o
       set to_date = p_transfer.transfer_date - 1
     where o.id = any (p_transfer.from_occupant_ids) and o.flat_id = p_transfer.flat_id and o.to_date is null
       and o.deleted_at is null
    returning o.user_id
  )
  select count(*) into v_closed from closed;

  -- 2. Buyers: members become owners from the transfer date; others are invited.
  select r.id into v_member_role from public.role r
   where r.society_id = p_transfer.society_id and r.name = 'Member' and r.is_system and r.deleted_at is null;

  for b in select * from jsonb_array_elements(p_transfer.buyers) loop
    select m.user_id into v_user
      from public.membership m join public.profiles pr on pr.id = m.user_id
     where m.society_id = p_transfer.society_id and m.status = 'active' and m.deleted_at is null
       and pr.email = b ->> 'email';
    if v_user is not null then
      insert into public.flat_occupant (society_id, flat_id, user_id, type, share_cert_no, from_date)
      values (p_transfer.society_id, p_transfer.flat_id, v_user, b ->> 'type', p_transfer.share_cert_no,
              p_transfer.transfer_date);
      v_added := v_added + 1;
    else
      if v_member_role is null then
        raise exception 'invalid_transfer: this society has no Member role to invite buyers with' using errcode = 'P0001';
      end if;
      perform private.expire_invites(p_transfer.society_id, b ->> 'email');
      if exists (select 1 from public.invite i where i.society_id = p_transfer.society_id
                 and i.email = b ->> 'email' and i.status = 'pending') then
        raise exception 'already_invited: % has a pending invite; revoke it before approving', b ->> 'email'
          using errcode = 'P0001';
      end if;
      perform private.check_invite_quota(p_transfer.society_id, 1);
      insert into public.invite (society_id, kind, email, full_name, role_ids, flat_id, occupant_type)
      values (p_transfer.society_id, 'member', b ->> 'email', b ->> 'full_name', array[v_member_role],
              p_transfer.flat_id, b ->> 'type');
      v_invited := v_invited + 1;
    end if;
    v_user := null;
  end loop;

  -- 3. Sellers left with nothing stop being members (once the transfer date has come).
  if p_transfer.transfer_date <= private.today_ist() then
    for v_seller in select distinct o.user_id from public.flat_occupant o where o.id = any (p_transfer.from_occupant_ids) loop
      if private.remove_if_left_with_nothing(p_transfer.society_id, v_seller) then
        v_removed := v_removed + 1;
      end if;
    end loop;
  end if;

  update public.flat_transfer
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_transfer.id;

  return jsonb_build_object('closed', v_closed, 'added', v_added, 'invited', v_invited, 'memberships_removed', v_removed);
end;
$$;

create or replace function public.approve_flat_transfer(p_transfer_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.flat_transfer;
begin
  select t.* into v_transfer from public.flat_transfer t where t.id = p_transfer_id and t.deleted_at is null for update;
  if v_transfer.id is null or not private.has_permission(v_transfer.society_id, 'members.transfer') then
    raise exception 'permission_denied: members.transfer' using errcode = '42501';
  end if;
  if not private.society_is_active(v_transfer.society_id) then
    raise exception 'society_inactive' using errcode = 'P0001';
  end if;
  if v_transfer.status <> 'requested' then
    raise exception 'transfer_not_pending: this transfer was already %', v_transfer.status using errcode = 'P0001';
  end if;
  if v_transfer.requested_by = auth.uid() then
    raise exception 'maker_checker: whoever requested a transfer cannot approve or reject it' using errcode = 'P0001';
  end if;

  if p_decision = 'reject' then
    if nullif(trim(p_reason), '') is null then
      raise exception 'invalid_transfer: give a reason for rejecting' using errcode = '22023';
    end if;
    update public.flat_transfer
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = trim(p_reason)
     where id = v_transfer.id;
    return jsonb_build_object('closed', 0, 'added', 0, 'invited', 0, 'memberships_removed', 0);
  elsif p_decision = 'approve' then
    return private.approve_flat_transfer_impl(v_transfer);
  end if;
  raise exception 'invalid_transfer: decision must be approve or reject' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly occupancy expiry (pg_cron), one transaction per society
-- ---------------------------------------------------------------------------

create or replace function private.occupancy_expiry_impl(p_society_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_removed integer := 0;
begin
  for v_user in
    select distinct o.user_id
    from public.flat_occupant o
    join public.membership m on m.society_id = o.society_id and m.user_id = o.user_id and m.status = 'active'
    where o.society_id = p_society_id and o.deleted_at is null and o.to_date < private.today_ist()
  loop
    if private.remove_if_left_with_nothing(p_society_id, v_user) then
      v_removed := v_removed + 1;
    end if;
  end loop;
  return v_removed;
end;
$$;

create or replace function private.run_occupancy_expiry()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
  v_run bigint;
begin
  perform set_config('app.actor', 'system:occupancy_expiry', true);
  for sid in select s.id from public.society s where s.deleted_at is null and s.status in ('trial', 'active') loop
    insert into public.job_run (society_id, job) values (sid, 'occupancy_expiry') returning id into v_run;
    begin
      perform private.occupancy_expiry_impl(sid);
      update public.job_run set status = 'succeeded', finished_at = now() where id = v_run;
    exception when others then
      update public.job_run set status = 'failed', finished_at = now(), error = sqlerrm where id = v_run;
    end;
  end loop;
end;
$$;

revoke all on function
  private.remove_if_left_with_nothing(uuid, uuid),
  private.approve_flat_transfer_impl(public.flat_transfer),
  private.occupancy_expiry_impl(uuid),
  private.run_occupancy_expiry()
from public, anon, authenticated;
revoke all on function public.request_flat_transfer(uuid, uuid, uuid[], jsonb, date, text, bigint, text) from public, anon;
revoke all on function public.approve_flat_transfer(uuid, text, text) from public, anon;
grant execute on function public.request_flat_transfer(uuid, uuid, uuid[], jsonb, date, text, bigint, text) to authenticated;
grant execute on function public.approve_flat_transfer(uuid, text, text) to authenticated;

-- 00:15 Asia/Kolkata every night (18:45 UTC).
create extension if not exists pg_cron;
select cron.schedule('occupancy-expiry', '45 18 * * *', 'select private.run_occupancy_expiry()');
