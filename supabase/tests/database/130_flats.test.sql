-- Wings, flats and occupants: the committee manages them, members see only their
-- own flat, tenants reach billing only when the owner allows it, and nothing
-- crosses societies.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- User ids, looked up once as postgres (signed-in roles cannot read auth.users).
create temp table t_uid as select email, id from auth.users;
grant select on t_uid to authenticated;
create function pg_temp.uid(p_email text) returns uuid language sql as $$
  select id from t_uid where email = p_email;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);
-- Start from no property data, whatever the seed holds.
update public.flat_occupant set deleted_at = now() where society_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
update public.flat set deleted_at = now() where society_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
update public.wing set deleted_at = now() where society_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);

-- ---- wings ------------------------------------------------------------------------
select pg_temp.as_user('secretary.a@society.test');
select lives_ok(format('insert into public.wing (society_id, name) values (%L, %L)', current_setting('t.a'), 'Tower T'),
  'the secretary (flats.manage) can add a wing');
select throws_ok(format('insert into public.wing (society_id, name) values (%L, %L)', current_setting('t.a'), 'Tower T'),
  '23505', null, 'wing names are unique within a society');
select throws_ok(format('insert into public.wing (society_id, name) values (%L, %L)', current_setting('t.b'), 'Spy wing'),
  '42501', null, 'the secretary of A cannot add a wing to Society B');
reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(format('insert into public.wing (society_id, name) values (%L, %L)', current_setting('t.a'), 'Rogue'),
  '42501', null, 'a member cannot add a wing');

-- ---- flats ------------------------------------------------------------------------
reset role;
select set_config('t.wing', (select id::text from public.wing where name = 'Tower T' and deleted_at is null), true);
select pg_temp.as_user('secretary.a@society.test');
select lives_ok(format(
  'insert into public.flat (society_id, wing_id, number, floor, area_sqft, flat_type) values (%L, %L, %L, 1, 650, %L), (%L, %L, %L, 1, 720, %L)',
  current_setting('t.a'), current_setting('t.wing'), '101', '2BHK',
  current_setting('t.a'), current_setting('t.wing'), '102', '2BHK'), 'the secretary can add flats');
select throws_ok(format('insert into public.flat (society_id, wing_id, number, area_sqft) values (%L, %L, %L, 500)',
  current_setting('t.a'), current_setting('t.wing'), '101'),
  '23505', null, 'a flat number is unique within its wing');
select throws_ok(format('insert into public.flat (society_id, wing_id, number, area_sqft) values (%L, %L, %L, 0)',
  current_setting('t.a'), current_setting('t.wing'), '103'),
  '23514', null, 'area must be positive');
reset role;
select throws_ok(format('insert into public.flat (society_id, wing_id, number, area_sqft) values (%L, %L, %L, 500)',
  current_setting('t.b'), current_setting('t.wing'), '999'),
  '23503', null, 'a Society B flat cannot sit in a Society A wing');

update public.society set quotas = quotas || '{"max_flats": 2}' where id = current_setting('t.a')::uuid;
select pg_temp.as_user('secretary.a@society.test');
select throws_like(format('insert into public.flat (society_id, wing_id, number, area_sqft) values (%L, %L, %L, 500)',
  current_setting('t.a'), current_setting('t.wing'), '103'),
  'quota_exceeded: max_flats%', 'the max_flats quota is enforced');
reset role;
update public.society set quotas = quotas || '{"max_flats": 300}' where id = current_setting('t.a')::uuid;

select set_config('t.f101', (select id::text from public.flat where wing_id = current_setting('t.wing')::uuid and number = '101'), true);
select set_config('t.f102', (select id::text from public.flat where wing_id = current_setting('t.wing')::uuid and number = '102'), true);

-- ---- occupants --------------------------------------------------------------------
select pg_temp.as_user('secretary.a@society.test');
select lives_ok(format(
  'insert into public.flat_occupant (society_id, flat_id, user_id, type, share_cert_no) values (%L, %L, %L, %L, %L)',
  current_setting('t.a'), current_setting('t.f101'), pg_temp.uid('member.a@society.test'), 'owner', 'SC-101'),
  'the secretary (members.manage) can record an owner');
select lives_ok(format(
  'insert into public.flat_occupant (society_id, flat_id, user_id, type) values (%L, %L, %L, %L)',
  current_setting('t.a'), current_setting('t.f102'), pg_temp.uid('tenant.a@society.test'), 'tenant'),
  'the secretary can record a tenant');
select throws_ok(format(
  'insert into public.flat_occupant (society_id, flat_id, user_id, type) values (%L, %L, %L, %L)',
  current_setting('t.a'), current_setting('t.f101'), pg_temp.uid('member.a@society.test'), 'owner'),
  '23505', null, 'the same person cannot hold two open occupancies of one flat');
reset role;
select throws_ok(format(
  'insert into public.flat_occupant (society_id, flat_id, user_id, type) values (%L, %L, %L, %L)',
  current_setting('t.b'), current_setting('t.f101'), pg_temp.uid('member.b@society.test'), 'owner'),
  '23503', null, 'a Society B occupancy cannot point at a Society A flat');

-- ---- who sees what ----------------------------------------------------------------
select pg_temp.as_user('member.a@society.test');
select is((select array_agg(number order by number) from public.flat where deleted_at is null), array['101'],
  'an owner sees only their own flat');
select is((select count(*)::int from public.flat_occupant where deleted_at is null), 1,
  'an owner sees only the occupants of their own flat');
update public.flat set area_sqft = 1 where id = current_setting('t.f101')::uuid;
reset role;
select is((select area_sqft from public.flat where id = current_setting('t.f101')::uuid), 650.00::numeric,
  'an owner cannot change their flat');

select pg_temp.as_user('committee.a@society.test');
select is((select count(*)::int from public.flat where deleted_at is null and society_id = current_setting('t.a')::uuid), 2,
  'a committee member (flats.view.all) sees every flat');

reset role;
select pg_temp.as_user('chair.b@society.test');
select is((select count(*)::int from public.flat where society_id = current_setting('t.a')::uuid)
        + (select count(*)::int from public.wing where society_id = current_setting('t.a')::uuid)
        + (select count(*)::int from public.flat_occupant where society_id = current_setting('t.a')::uuid), 0,
  'Society B sees no Society A wings, flats or occupants');

-- ---- my_flat_ids / my_billable_flat_ids --------------------------------------------
reset role;
select pg_temp.as_user('tenant.a@society.test');
select is((select array_agg(x) from private.my_flat_ids(current_setting('t.a')::uuid) x), array[current_setting('t.f102')::uuid],
  'a tenant''s flats include the rented flat');
select is((select count(*)::int from private.my_billable_flat_ids(current_setting('t.a')::uuid)), 0,
  'a tenant reaches no bills until the owner allows it');
reset role;
update public.flat_occupant set can_view_bills = true where user_id = pg_temp.uid('tenant.a@society.test');
select pg_temp.as_user('tenant.a@society.test');
select is((select count(*)::int from private.my_billable_flat_ids(current_setting('t.a')::uuid)), 1,
  'with can_view_bills, the tenant reaches the flat''s bills');
reset role;
update public.flat_occupant set to_date = current_date - 1, from_date = current_date - 30
 where user_id = pg_temp.uid('tenant.a@society.test');
select pg_temp.as_user('tenant.a@society.test');
select is((select count(*)::int from private.my_flat_ids(current_setting('t.a')::uuid)), 0,
  'an ended tenancy no longer counts');

-- ---- invites tied to a flat ---------------------------------------------------------
reset role;
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
        'owner.102@society.test', '{}', '{}', now(), now());
insert into t_uid select email, id from auth.users where email = 'owner.102@society.test';
select pg_temp.as_user('secretary.a@society.test');
select set_config('t.tok', (select token from public.create_invite(
  current_setting('t.a')::uuid, 'owner.102@society.test',
  array[(select id from public.role where society_id = current_setting('t.a')::uuid and name = 'Member')],
  'Owner 102', current_setting('t.f102')::uuid, 'owner')), true);
reset role;
select pg_temp.as_user('owner.102@society.test');
select public.accept_invite(current_setting('t.tok'));
reset role;
select is((select type from public.flat_occupant
            where flat_id = current_setting('t.f102')::uuid and user_id = pg_temp.uid('owner.102@society.test')),
  'owner', 'accepting a flat invite records the person as that flat''s owner');

insert into public.wing (society_id, name) values (current_setting('t.b')::uuid, 'B Tower');
insert into public.flat (society_id, wing_id, number, area_sqft)
select current_setting('t.b')::uuid, id, '1', 500 from public.wing where society_id = current_setting('t.b')::uuid and name = 'B Tower';
select set_config('t.bflat', (select f.id::text from public.flat f join public.wing w on w.id = f.wing_id where w.name = 'B Tower'), true);
select set_config('t.member_role', (select id::text from public.role where society_id = current_setting('t.a')::uuid and name = 'Member'), true);
select pg_temp.as_user('secretary.a@society.test');
select throws_ok(format('select * from public.create_invite(%L, %L, array[%L]::uuid[], null, %L, %L)',
  current_setting('t.a'), 'x@society.test', current_setting('t.member_role'), current_setting('t.bflat'), 'owner'),
  '42501', null, 'an invite cannot name a flat of another society');

-- ---- member directory ---------------------------------------------------------------
reset role;
select pg_temp.as_user('owner.102@society.test');
select ok(exists (select 1 from public.member_directory(current_setting('t.a')::uuid)
                  where full_name = 'Ravi Deshmukh' and flats = array['Tower T-101']),
  'members can see each other''s names and flats in the directory');

select * from finish();
rollback;
