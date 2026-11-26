-- Platform admin RPCs and the service-role onboarding steps.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.admin', (select id::text from auth.users where email = 'admin@society.test'), true);
select set_config('t.chair', (select id::text from auth.users where email = 'chair.a@society.test'), true);

-- ---- platform_set_society_status / platform_set_quotas ------------------------------
select pg_temp.as_user('chair.a@society.test');
select throws_ok(format('select public.platform_set_society_status(%L, %L)', current_setting('t.a'), 'suspended'),
  '42501', null, 'a chairman cannot change society status');
select throws_ok(format('select public.platform_set_quotas(%L, null, %L)', current_setting('t.a'), '{"max_flats": 9999}'),
  '42501', null, 'a chairman cannot change quotas');
select throws_ok(format('select public.admin_onboard_begin(%L, %L, %L)', current_setting('t.chair'), '{"name":"X CHS"}', '[]'),
  '42501', null, 'signed-in users cannot call the service-role onboarding RPCs at all');

-- The chairman may edit the society name (society.update) but not its status, plan or quotas.
select lives_ok(format('update public.society set name = %L where id = %L', 'Green Park CHS Ltd', current_setting('t.a')),
  'a chairman can rename the society');
select throws_ok(format('update public.society set status = %L where id = %L', 'active', current_setting('t.a')),
  '42501', null, 'a chairman cannot update society status directly');
select throws_ok(format('update public.society set quotas = %L where id = %L', '{}', current_setting('t.a')),
  '42501', null, 'a chairman cannot update quotas directly');

reset role;
select pg_temp.as_user('member.a@society.test');
update public.society set name = 'Hacked' where id = current_setting('t.a')::uuid;
reset role;
select is((select name from public.society where id = current_setting('t.a')::uuid), 'Green Park CHS Ltd',
  'a member without society.update changes nothing');

select pg_temp.as_user('admin@society.test');
select lives_ok(format('select public.platform_set_society_status(%L, %L)', current_setting('t.a'), 'suspended'),
  'the super-admin can suspend a society');
reset role;
select is((select status from public.society where id = current_setting('t.a')::uuid), 'suspended', 'status is suspended');
select ok(not private.society_is_active(current_setting('t.a')::uuid), 'a suspended society is not active');

select pg_temp.as_user('chair.a@society.test');
select is((select count(*)::int from public.society where id = current_setting('t.a')::uuid), 1,
  'members can still read a suspended society');
update public.society set name = 'Renamed while suspended' where id = current_setting('t.a')::uuid;
reset role;
select is((select name from public.society where id = current_setting('t.a')::uuid), 'Green Park CHS Ltd',
  'a suspended society refuses writes');

select pg_temp.as_user('admin@society.test');
select is((public.platform_set_quotas(current_setting('t.a')::uuid, 'standard', '{"max_flats": 500}') ->> 'max_flats'), '500',
  'the super-admin can raise a quota');
select throws_ok(format('select public.platform_set_quotas(%L, null, %L)', current_setting('t.a'), '{"free_lunches": 1}'),
  '22023', null, 'unknown quota keys are refused');
select throws_ok(format('select public.platform_set_quotas(%L, null, %L)', current_setting('t.a'), '{"max_flats": -1}'),
  '22023', null, 'negative quotas are refused');

-- ---- onboarding steps (service role) ------------------------------------------------
reset role;
set local role service_role;

select throws_ok(
  format('select public.admin_onboard_begin(%L, %L, %L)', current_setting('t.chair'), '{"name":"Rogue CHS"}',
         '[{"email":"x@society.test","full_name":"X","roles":["Chairman"]}]'),
  '42501', null, 'onboarding refuses an actor who is not a platform admin');
select throws_like(
  format('select public.admin_onboard_begin(%L, %L, %L)', current_setting('t.admin'), '{"name":"Bad Roles CHS"}',
         '[{"email":"x@society.test","full_name":"X","roles":["Emperor"]}]'),
  'invalid_committee: unknown role%', 'onboarding refuses an unknown role name');

select set_config('t.begin', public.admin_onboard_begin(
  current_setting('t.admin')::uuid,
  '{"name": "Lake View CHS", "registration_no": "PUN/HSG/9009", "quotas": {"max_flats": 120}}',
  '[{"email": "chair.l@society.test", "full_name": "Lata", "roles": ["Chairman"]}]')::text, true);
select set_config('t.l', current_setting('t.begin')::jsonb ->> 'society_id', true);

select is((select status from public.society where id = current_setting('t.l')::uuid), 'onboarding',
  'a new society starts in onboarding');
select is((select (quotas ->> 'max_flats')::int from public.society where id = current_setting('t.l')::uuid), 120,
  'quota overrides from the request are applied');
select throws_like(
  format('select public.admin_onboard_begin(%L, %L, %L)', current_setting('t.admin'),
         '{"name": "Copy CHS", "registration_no": "PUN/HSG/9009"}',
         '[{"email":"copy@society.test","full_name":"C","roles":["Chairman"]}]'),
  'duplicate_registration%', 'a duplicate registration number is refused');

-- Create the account the Edge Function would create (through the Auth API), then finish.
reset role;
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000d1', 'authenticated',
        'authenticated', 'chair.l@society.test', '{}', '{}', now(), now());
set local role service_role;
select lives_ok(format('select public.admin_onboard_finish(%L, %L, %L, %L)',
  current_setting('t.admin'), current_setting('t.l'),
  jsonb_build_array(jsonb_build_object(
    'invite_id', current_setting('t.begin')::jsonb -> 'invites' -> 0 ->> 'invite_id',
    'user_id', '00000000-0000-4000-8000-0000000000d1')),
  'active'), 'finishing onboarding activates the society and its committee');
select is((select s.status || ':' || p.full_name || ':' || r.name
             from public.society s
             join public.membership m on m.society_id = s.id
             join public.profiles p on p.id = m.user_id
             join public.membership_role mr on mr.membership_id = m.id
             join public.role r on r.id = mr.role_id
            where s.id = current_setting('t.l')::uuid),
  'active:Lata:Chairman', 'the committee member is an active Chairman, named from the invite');

-- Abort closes a society that never finished onboarding.
select set_config('t.begin2', public.admin_onboard_begin(
  current_setting('t.admin')::uuid, '{"name": "Half Done CHS"}',
  '[{"email": "half@society.test", "full_name": "H", "roles": ["Chairman"]}]')::text, true);
select public.admin_onboard_abort(current_setting('t.admin')::uuid,
  (current_setting('t.begin2')::jsonb ->> 'society_id')::uuid,
  array[(current_setting('t.begin2')::jsonb -> 'invites' -> 0 ->> 'invite_id')::uuid]);
select is((select status || ':' || (deleted_at is not null)::text from public.society
            where id = (current_setting('t.begin2')::jsonb ->> 'society_id')::uuid),
  'closed:true', 'aborting closes and soft-deletes the half-made society');

select * from finish();
rollback;
