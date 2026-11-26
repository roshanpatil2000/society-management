-- Tenant discovery: before login, anyone can look up a society by its code and get
-- only public details (name, city, logo, login methods). Nothing else leaks.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);

-- ---- lookup (anonymous) -------------------------------------------------------------
select pg_temp.as_anon();
select is((select name from public.discover_society('greenpark')), 'Green Park CHS', 'anyone can look up a society by code');
select is((select name from public.discover_society('  GreenPark ')), 'Green Park CHS', 'the code ignores case and spaces');
select is((select slug from public.discover_society('https://app.societyapp.in/s/greenpark')), 'greenpark',
  'a full web link works');
select is((select slug from public.discover_society('societyapp://s/blueridge')), 'blueridge', 'a deep link works');
select is((select slug from public.discover_society('greenpark.societyapp.in')), 'greenpark', 'a subdomain works');
select is((select login_methods from public.discover_society('greenpark')), array['email_otp', 'google'],
  'the lookup returns the society''s login methods');
select is((select city from public.discover_society('greenpark')), 'Andheri West, Mumbai', 'the lookup returns the address line');
select is((select society_id::text from public.discover_society('greenpark')), current_setting('t.a'),
  'the lookup returns the society id the app will use');
select is((select count(*)::int from public.discover_society('nope-not-real')), 0, 'an unknown code returns nothing');
select is((select count(*)::int from public.discover_society('')), 0, 'an empty code returns nothing');
select is(pg_get_function_result('public.discover_society(text)'::regprocedure),
  'TABLE(society_id uuid, slug text, name text, city text, logo_url text, login_methods text[])',
  'the lookup returns only public columns: no members, quotas or settings');
select throws_ok('select count(*) from public.society', '42501', null, 'anon still cannot read the society table');

-- ---- hidden societies ---------------------------------------------------------------
reset role;
update public.society set status = 'suspended' where id = current_setting('t.a')::uuid;
select pg_temp.as_anon();
select is((select count(*)::int from public.discover_society('greenpark')), 0, 'a suspended society is not discoverable');
reset role;
update public.society set status = 'trial', trial_ends_at = now() - interval '1 day' where id = current_setting('t.a')::uuid;
select pg_temp.as_anon();
select is((select count(*)::int from public.discover_society('greenpark')), 0, 'an expired trial is not discoverable');
reset role;
update public.society set status = 'trial', trial_ends_at = now() + interval '10 days' where id = current_setting('t.a')::uuid;
select pg_temp.as_anon();
select is((select count(*)::int from public.discover_society('greenpark')), 1, 'a society in its trial is discoverable');
reset role;
update public.society set status = 'active', deleted_at = now() where id = current_setting('t.a')::uuid;
select pg_temp.as_anon();
select is((select count(*)::int from public.discover_society('greenpark')), 0, 'a deleted society is not discoverable');
reset role;
update public.society set deleted_at = null where id = current_setting('t.a')::uuid;

-- ---- slug rules -----------------------------------------------------------------------
select throws_ok(format('update public.society set slug = %L where id = %L', 'Bad Slug', current_setting('t.a')),
  '23514', null, 'a slug with spaces or capitals is refused');
select throws_ok(format('update public.society set slug = %L where id = %L', 'admin', current_setting('t.a')),
  '23514', null, 'a reserved word cannot be a slug');
select throws_ok(format('update public.society set slug = %L where id = %L', 'blueridge', current_setting('t.a')),
  '23505', null, 'two societies cannot share a slug');
select throws_ok(format('update public.society set login_methods = %L where id = %L', '{email_otp,passwords}', current_setting('t.a')),
  '23514', null, 'only known login methods are allowed');
select throws_like('select private.create_society_impl(''{"name": "No Code CHS"}'')',
  'invalid_society: slug%', 'a new society needs a slug');
select set_config('t.code', private.create_society_impl('{"name": "Code CHS", "slug": "Code-CHS"}')::text, true);
select is((select slug from public.society where id = current_setting('t.code')::uuid),
  'code-chs', 'create_society_impl stores the normalised slug');

-- ---- who may change it -----------------------------------------------------------------
select pg_temp.as_user('chair.a@society.test');
select throws_ok(format('select public.platform_set_society_slug(%L, %L)', current_setting('t.a'), 'green-park'),
  '42501', null, 'a chairman cannot change the society code');
select throws_ok(format('update public.society set slug = %L where id = %L', 'green-park', current_setting('t.a')),
  '42501', null, 'the slug cannot be updated directly');
reset role;
select pg_temp.as_user('admin@society.test');
select lives_ok(format('select public.platform_set_society_slug(%L, %L)', current_setting('t.a'), 'Green-Park'),
  'the super-admin can change the society code');
select is((select slug from public.society where id = current_setting('t.a')::uuid), 'green-park',
  'the new code is stored normalised');

select * from finish();
rollback;
