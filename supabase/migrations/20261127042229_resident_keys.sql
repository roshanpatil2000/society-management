-- Resident-level keys: the keys every Member or Tenant gets. They only reach a
-- person's own flat or society-wide public information, so a committee member who
-- may invite or manage roles can grant them without holding them (a secretary can
-- invite a Member). Committee powers still need the granter to hold the key.
-- Same list as RESIDENT_KEYS in packages/shared (checked by the sync test).

alter table public.permission add column resident boolean not null default false;

update public.permission
   set resident = true
 where key in (select unnest(p.permissions) from public.role_preset p where p.name in ('Member', 'Tenant'));

-- The caller may grant these roles if each belongs to the society and every
-- non-resident key they carry is one the caller holds.
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
         and not exists (select 1 from public.permission k where k.key = p and k.resident)
     );
$$;

-- The caller holds every non-resident key in the list (42501 otherwise).
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
  where not (k = any (private.my_permissions(sid)))
    and not exists (select 1 from public.permission p where p.key = k and p.resident)
  limit 1;
  if missing is not null then
    raise exception 'permission_denied: you do not hold %', missing using errcode = '42501';
  end if;
end;
$$;
