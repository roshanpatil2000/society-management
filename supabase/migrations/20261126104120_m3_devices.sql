-- Push-notification devices. A device belongs to a person, not a society; a person
-- registers and unregisters only their own. A token re-registered by someone else
-- (a phone handed down) moves to them, so notifications never reach the old owner.

create table public.device (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index device_user_idx on public.device (user_id) where deleted_at is null;
alter table public.device enable row level security;
revoke all on public.device from anon, authenticated;
grant select on public.device to authenticated;
create policy device_select_own on public.device for select to authenticated using (
  user_id = (select auth.uid()) and deleted_at is null
);
create trigger device_set_updated_at before update on public.device
  for each row execute function private.set_updated_at();
create trigger device_audit after insert or update or delete on public.device
  for each row execute function private.audit_row();

create or replace function public.register_device(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'permission_denied: sign in first' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$' then
    raise exception 'invalid_device: not an Expo push token' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid_device: unknown platform %', p_platform using errcode = '22023';
  end if;

  insert into public.device (user_id, expo_push_token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now(),
        deleted_at = null;
end;
$$;

create or replace function public.unregister_device(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.device
     set deleted_at = now()
   where expo_push_token = p_token and user_id = (select auth.uid()) and deleted_at is null;
end;
$$;

revoke all on function public.register_device(text, text), public.unregister_device(text) from public, anon;
grant execute on function public.register_device(text, text), public.unregister_device(text) to authenticated;
