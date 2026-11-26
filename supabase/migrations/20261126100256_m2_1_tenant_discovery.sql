-- M2.1 Tenant discovery: every society has a public code (slug). Before login the
-- app looks the code up with discover_society, which returns only public details.
-- Discovery grants nothing: RLS still decides every read and write after login.
-- Slug rules mirror packages/shared/src/society-code.ts.

-- ---------------------------------------------------------------------------
-- Slug rules
-- ---------------------------------------------------------------------------

create or replace function private.is_valid_society_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug is not null
     and length(p_slug) between 3 and 30
     and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     and p_slug not in ('www', 'app', 'api', 'admin', 's', 'login', 'auth', 'help', 'support', 'staging', 'static');
$$;

-- Accepts a typed code, a web link (.../s/<code>), a deep link (societyapp://s/<code>)
-- or a subdomain (<code>.<domain>.<tld>). Returns the code, or null.
create or replace function private.normalize_society_code(p_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw text := lower(trim(coalesce(p_input, '')));
  without_scheme text;
  candidate text;
  host text;
begin
  if raw = '' then
    return null;
  end if;
  without_scheme := regexp_replace(raw, '^[a-z][a-z0-9+.-]*://', '/');
  candidate := substring(without_scheme from '(?:^|/)s/([^/?#]+)');
  if candidate is null then
    if raw ~ '[./]' then
      host := split_part(regexp_replace(raw, '^[a-z][a-z0-9+.-]*://', ''), '/', 1);
      host := split_part(split_part(host, '?', 1), '#', 1);
      candidate := case when array_length(string_to_array(host, '.'), 1) >= 3 then split_part(host, '.', 1) end;
    else
      candidate := raw;
    end if;
  end if;
  return case when private.is_valid_society_slug(candidate) then candidate end;
end;
$$;

-- A starting slug from a society name (used to backfill societies created before M2.1).
create or replace function private.suggest_society_slug(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  word text;
  slug text := '';
begin
  foreach word in array regexp_split_to_array(trim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')), ' ') loop
    continue when word = '' or word in ('chs', 'co', 'op', 'coop', 'cooperative', 'operative', 'housing',
                                        'society', 'soc', 'hsg', 'ltd', 'limited', 'the', 'and');
    exit when length(slug) + length(word) + 1 > 30;
    slug := case when slug = '' then word else slug || '-' || word end;
  end loop;
  if length(slug) < 3 or not private.is_valid_society_slug(slug) then
    slug := left(case when slug = '' then 'society' else slug end || '-chs', 30);
  end if;
  return slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.society
  add column slug text,
  add column logo_path text,
  add column login_methods text[] not null default '{email_otp,google}';

-- Backfill: a slug from the name, with a number added if it is taken.
do $$
declare
  s record;
  base text;
  candidate text;
  n int;
begin
  perform set_config('app.actor', 'migration:m2_1_tenant_discovery', true);
  for s in select id, name, deleted_at from public.society where slug is null order by created_at loop
    base := private.suggest_society_slug(s.name);
    candidate := base;
    n := 1;
    while exists (select 1 from public.society x where x.slug = candidate and x.deleted_at is null) loop
      n := n + 1;
      candidate := left(base, 30 - length(n::text) - 1) || '-' || n;
    end loop;
    update public.society set slug = candidate where id = s.id;
  end loop;
end;
$$;

alter table public.society
  alter column slug set not null,
  add constraint society_slug_valid check (private.is_valid_society_slug(slug)),
  add constraint society_login_methods_valid check (
    cardinality(login_methods) >= 1 and login_methods <@ array['email_otp', 'google']::text[]);
create unique index society_slug_key on public.society (slug) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- create_society_impl now requires a slug
-- ---------------------------------------------------------------------------

create or replace function private.create_society_impl(p_society jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(trim(p_society ->> 'name'), '');
  v_slug text := private.normalize_society_code(p_society ->> 'slug');
begin
  if v_name is null then
    raise exception 'invalid_society: name is required' using errcode = '22023';
  end if;
  if v_slug is null then
    raise exception 'invalid_society: slug must be 3 to 30 letters, digits or single hyphens, and not a reserved word'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.society s where s.slug = v_slug and s.deleted_at is null) then
    raise exception 'duplicate_slug: the society code % is taken', v_slug using errcode = 'P0001';
  end if;
  if nullif(trim(p_society ->> 'registration_no'), '') is not null and exists (
    select 1 from public.society s
    where s.registration_no = trim(p_society ->> 'registration_no') and s.deleted_at is null
  ) then
    raise exception 'duplicate_registration: a society with registration number % already exists',
      trim(p_society ->> 'registration_no') using errcode = 'P0001';
  end if;

  insert into public.society (name, slug, registration_no, address, gstin, plan, financial_year_start_month)
  values (
    v_name,
    v_slug,
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

-- ---------------------------------------------------------------------------
-- Public discovery lookup (the only function anon may call)
-- ---------------------------------------------------------------------------

create or replace function public.discover_society(p_code text)
returns table (
  society_id uuid,
  slug text,
  name text,
  city text,
  logo_url text,
  login_methods text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.slug, s.name, s.address, s.logo_path, s.login_methods
  from public.society s
  where s.slug = private.normalize_society_code(p_code)
    and s.deleted_at is null
    and private.society_is_active(s.id);
$$;

-- Only the super-admin changes a society's code (it is printed on QR codes).
create or replace function public.platform_set_society_slug(p_society_id uuid, p_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := private.normalize_society_code(p_slug);
begin
  perform private.assert_platform_admin((select auth.uid()));
  if v_slug is null then
    raise exception 'invalid_society: slug must be 3 to 30 letters, digits or single hyphens, and not a reserved word'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.society s
             where s.slug = v_slug and s.deleted_at is null and s.id <> p_society_id) then
    raise exception 'duplicate_slug: the society code % is taken', v_slug using errcode = 'P0001';
  end if;
  update public.society set slug = v_slug where id = p_society_id and deleted_at is null;
  if not found then
    raise exception 'society_not_found' using errcode = 'P0001';
  end if;
  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- The slug check backs a CHECK constraint, and constraints run their functions as
-- the user making the change, so every role that may update a society row needs it.
-- It is a pure function with no data access.
revoke all on function private.is_valid_society_slug(text) from public, anon;
grant execute on function private.is_valid_society_slug(text) to authenticated, service_role;
revoke all on function
  private.normalize_society_code(text),
  private.suggest_society_slug(text)
from public, anon, authenticated;

revoke all on function public.discover_society(text) from public;
grant execute on function public.discover_society(text) to anon, authenticated;

revoke all on function public.platform_set_society_slug(uuid, text) from public, anon;
grant execute on function public.platform_set_society_slug(uuid, text) to authenticated;
