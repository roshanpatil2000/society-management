-- Role presets: every society gets the eight default roles, and each preset holds
-- exactly its permissions. Seed users in Green Park CHS hold one preset each.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.preset(p_name text) returns text[] language sql as $$
  select array(select unnest(permissions) order by 1) from public.role_preset where name = p_name;
$$;
create function pg_temp.perms_of(p_email text) returns text[] language plpgsql as $$
declare
  result text[];
begin
  perform pg_temp.as_user(p_email);
  result := public.get_my_permissions((select id from public.society where name = 'Green Park CHS'));
  reset role;
  return result;
end;
$$;

select is((select count(*)::int from public.role_preset), 8, 'there are eight role presets');
select ok(not exists (select 1 from public.role_preset, unnest(permissions) k where k like 'platform.%'),
  'no preset carries a platform permission');

-- A brand-new society gets all eight, as system roles, with the preset permissions.
select set_config('t.new', private.create_society_impl('{"name": "Preset Test CHS", "slug": "preset-test"}')::text, true);
select is(
  (select array_agg(r.name order by p.sort_order)
     from public.role r join public.role_preset p on p.name = r.name
    where r.society_id = current_setting('t.new')::uuid and r.is_system),
  array['Chairman', 'Secretary', 'Treasurer', 'Committee member', 'Member', 'Tenant', 'Staff', 'Auditor'],
  'a new society gets the eight preset roles as system roles');
select is(
  (select count(*)::int
     from public.role r join public.role_preset p on p.name = r.name
    where r.society_id = current_setting('t.new')::uuid
      and array(select unnest(r.permissions) order by 1) is distinct from array(select unnest(p.permissions) order by 1)),
  0, 'each new role holds exactly its preset permissions');

-- Societies that existed before M2 were brought up to the presets too.
select is(
  (select count(*)::int from public.society s
    where s.deleted_at is null
      and (select count(*) from public.role r where r.society_id = s.id and r.is_system) <> 8),
  0, 'every existing society has the eight system roles');

-- Each seed user's effective permissions are exactly their preset.
select is(pg_temp.perms_of('chair.a@society.test'), pg_temp.preset('Chairman'), 'Chairman has the Chairman preset');
select is(pg_temp.perms_of('secretary.a@society.test'), pg_temp.preset('Secretary'), 'Secretary has the Secretary preset');
select is(pg_temp.perms_of('treasurer.a@society.test'), pg_temp.preset('Treasurer'), 'Treasurer has the Treasurer preset');
select is(pg_temp.perms_of('committee.a@society.test'), pg_temp.preset('Committee member'),
  'Committee member has the Committee member preset');
select is(pg_temp.perms_of('member.a@society.test'), pg_temp.preset('Member'), 'Member has the Member preset');
select is(pg_temp.perms_of('tenant.a@society.test'), pg_temp.preset('Tenant'), 'Tenant has the Tenant preset');
select is(pg_temp.perms_of('staff.a@society.test'), pg_temp.preset('Staff'), 'Staff has the Staff preset');
select is(pg_temp.perms_of('auditor.a@society.test'), pg_temp.preset('Auditor'), 'Auditor has the Auditor preset');

-- Presets are readable reference data for signed-in users, and nobody writes them.
select pg_temp.as_user('member.a@society.test');
select throws_ok('update public.role_preset set permissions = ''{}''', '42501', null,
  'signed-in users cannot change role presets');

select * from finish();
rollback;
