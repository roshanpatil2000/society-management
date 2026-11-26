-- create_role, update_role, assign_roles: roles.manage required, never grant or take
-- away what you don't hold, never leave a society without a roles.manage holder.
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
create function pg_temp.membership(p_email text, p_society text) returns uuid language sql as $$
  select m.id from public.membership m
  join public.profiles p on p.id = m.user_id
  join public.society s on s.id = m.society_id
  where p.email = p_email and s.name = p_society;
$$;
create function pg_temp.role_id(p_society text, p_role text) returns uuid language sql as $$
  select r.id from public.role r join public.society s on s.id = r.society_id
  where s.name = p_society and r.name = p_role;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);
select set_config('t.member_a', pg_temp.membership('member.a@society.test', 'Green Park CHS')::text, true);
select set_config('t.treasurer_a', pg_temp.membership('treasurer.a@society.test', 'Green Park CHS')::text, true);
select set_config('t.member_b', pg_temp.membership('member.b@society.test', 'Blue Ridge CHS')::text, true);
select set_config('t.chair_b', pg_temp.membership('chair.b@society.test', 'Blue Ridge CHS')::text, true);
select set_config('t.r_chair_a', pg_temp.role_id('Green Park CHS', 'Chairman')::text, true);
select set_config('t.r_treasurer_a', pg_temp.role_id('Green Park CHS', 'Treasurer')::text, true);
select set_config('t.r_member_a', pg_temp.role_id('Green Park CHS', 'Member')::text, true);
select set_config('t.r_chair_b', pg_temp.role_id('Blue Ridge CHS', 'Chairman')::text, true);
select set_config('t.r_member_b', pg_temp.role_id('Blue Ridge CHS', 'Member')::text, true);

-- ---- create_role ---------------------------------------------------------------
select pg_temp.as_user('chair.a@society.test');
select lives_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Garden committee',
  '{notices.view,notices.manage,complaints.view.all}'), 'the chairman can create a custom role');
select is((select permissions from public.role where name = 'Garden committee'),
  array['complaints.view.all', 'notices.manage', 'notices.view'], 'the custom role has the given permissions');
select is((select is_system from public.role where name = 'Garden committee'), false, 'a created role is not a system role');
select throws_like(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Garden committee', '{notices.view}'),
  'duplicate_role%', 'role names are unique within a society');
select throws_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Bogus', '{made.up}'),
  '22023', null, 'an unknown permission key is refused');
select throws_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Godlike', '{platform.societies.create}'),
  '42501', null, 'a platform key can never be put in a society role');
select throws_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.b'), 'Spy', '{notices.view}'),
  '42501', null, 'the chairman of A cannot create a role in Society B');

reset role;
select pg_temp.as_user('secretary.a@society.test');
select lives_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Notice board', '{notices.manage}'),
  'the secretary (roles.manage) can create a role within their own permissions');
select throws_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Approver', '{bills.approve}'),
  '42501', null, 'the secretary cannot create a role with bills.approve, which they lack');

reset role;
select pg_temp.as_user('treasurer.a@society.test');
select throws_ok(format('select public.create_role(%L, %L, %L)', current_setting('t.a'), 'Helper', '{notices.view}'),
  '42501', null, 'the treasurer (no roles.manage) cannot create roles');

-- ---- update_role ---------------------------------------------------------------
reset role;
select pg_temp.as_user('secretary.a@society.test');
select throws_ok(format('select public.update_role(%L, null, %L)', current_setting('t.r_chair_a'), '{notices.view}'),
  '42501', null, 'the secretary cannot edit the Chairman role, which holds keys they lack');
select lives_ok(format('select public.update_role((select id from public.role where name = %L), %L, null)',
  'Notice board', 'Notice board team'), 'the secretary can rename a role within their permissions');

reset role;
select pg_temp.as_user('chair.a@society.test');
select lives_ok(format('select public.update_role(%L, null, %L)', current_setting('t.r_member_a'),
  '{bills.view.own,payments.make.own,members.view.own,complaints.create,complaints.view.own,dashboard.view,expenses.view,notices.view,flats.view.all}'),
  'the chairman can widen the Member role');
select ok('flats.view.all' = any ((select permissions from public.role where id = current_setting('t.r_member_a')::uuid)::text[]),
  'the Member role now includes flats.view.all');
select throws_like(format('select public.update_role(%L, %L, null)', current_setting('t.r_member_a'), 'Owners'),
  'invalid_role: system roles%', 'system roles cannot be renamed');

-- Lockout: in Blue Ridge only the Chairman role holds roles.manage.
reset role;
select pg_temp.as_user('chair.b@society.test');
select throws_like(format('select public.update_role(%L, null, %L)', current_setting('t.r_chair_b'), '{society.view}'),
  'lockout%', 'removing roles.manage from the only role that has it is refused');

-- ---- assign_roles --------------------------------------------------------------
reset role;
select pg_temp.as_user('chair.a@society.test');
select lives_ok(format('select public.assign_roles(%L, array[%L, %L]::uuid[])', current_setting('t.member_a'),
  current_setting('t.r_member_a'), current_setting('t.r_treasurer_a')), 'the chairman can make a member treasurer too');
reset role;
select pg_temp.as_user('member.a@society.test');
select ok('payments.verify' = any (public.get_my_permissions(current_setting('t.a')::uuid)),
  'the member now has the treasurer''s permissions');
select throws_ok(format('select public.assign_roles(%L, array[%L]::uuid[])', current_setting('t.member_a'), current_setting('t.r_chair_a')),
  '42501', null, 'a member without roles.manage cannot assign roles (not even to themself)');

reset role;
select pg_temp.as_user('secretary.a@society.test');
select throws_ok(format('select public.assign_roles(%L, array[%L]::uuid[])', current_setting('t.member_a'), current_setting('t.r_chair_a')),
  '42501', null, 'the secretary cannot give anyone the Chairman role');
select throws_ok(format('select public.assign_roles(%L, array[%L]::uuid[])', current_setting('t.treasurer_a'), current_setting('t.r_member_a')),
  '42501', null, 'the secretary cannot take the Treasurer role away (it holds keys they lack)');

reset role;
select pg_temp.as_user('chair.a@society.test');
select throws_ok(format('select public.assign_roles(%L, array[%L]::uuid[])', current_setting('t.member_b'), current_setting('t.r_member_b')),
  '42501', null, 'the chairman of A cannot assign roles in Society B');
select throws_ok(format('select public.assign_roles(%L, array[%L]::uuid[])', current_setting('t.member_a'), current_setting('t.r_member_b')),
  '42501', null, 'a Society B role cannot be assigned in Society A');

reset role;
select pg_temp.as_user('chair.b@society.test');
select throws_like(format('select public.assign_roles(%L, array[%L]::uuid[])', current_setting('t.chair_b'), current_setting('t.r_member_b')),
  'lockout%', 'the last roles.manage holder cannot drop their own admin role');

-- Direct table writes stay closed.
select throws_ok(format('insert into public.membership_role (society_id, membership_id, role_id) values (%L, %L, %L)',
  current_setting('t.b'), current_setting('t.member_b'), current_setting('t.r_chair_b')),
  '42501', null, 'role assignments cannot be written directly');

select * from finish();
rollback;
