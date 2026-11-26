-- Consent notice (DPDP Act 2023): record which version of the notice each person
-- accepted and when. The app shows the notice until the current version is accepted.

alter table public.profiles
  add column consent_version smallint check (consent_version is null or consent_version >= 1),
  add column consent_accepted_at timestamptz;

create or replace function public.accept_consent(p_version integer)
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
  if p_version is null or p_version < 1 then
    raise exception 'invalid_consent: version must be 1 or more' using errcode = '22023';
  end if;
  update public.profiles
     set consent_version = greatest(coalesce(consent_version, 0), p_version),
         consent_accepted_at = now()
   where id = v_uid;
end;
$$;

revoke all on function public.accept_consent(integer) from public, anon;
grant execute on function public.accept_consent(integer) to authenticated;
