-- Auth hooks and auth.users triggers: no self-registration, profile creation,
-- super-admin bootstrap, and the Send Email hook's limits.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create function pg_temp.event(p_email text) returns jsonb language sql as $$
  select jsonb_build_object('metadata', '{}'::jsonb, 'user', jsonb_build_object('email', p_email));
$$;

-- ---- hook_before_user_created -------------------------------------------------
select is(private.hook_before_user_created(pg_temp.event('random@gmail.com')) -> 'error' ->> 'http_code', '403',
  'an email with no invite is rejected with 403');
select is(private.hook_before_user_created(pg_temp.event(null)) -> 'error' ->> 'http_code', '403',
  'a signup with no email is rejected');
select is(private.hook_before_user_created(pg_temp.event('Invitee.A@Society.test')), '{}'::jsonb,
  'an email with a pending invite is allowed (case-insensitive)');
select is(private.hook_before_user_created(pg_temp.event('admin@society.test')), '{}'::jsonb,
  'a bootstrap super-admin email is allowed');

update public.invite set expires_at = now() - interval '1 second' where email = 'invitee.a@society.test';
select is(private.hook_before_user_created(pg_temp.event('invitee.a@society.test')) -> 'error' ->> 'http_code', '403',
  'an expired invite does not allow signup');
update public.invite set expires_at = now() + interval '1 day', status = 'revoked' where email = 'invitee.a@society.test';
select is(private.hook_before_user_created(pg_temp.event('invitee.a@society.test')) -> 'error' ->> 'http_code', '403',
  'a revoked invite does not allow signup');
update public.invite set status = 'pending' where email = 'invitee.a@society.test';
update public.society set status = 'closed' where name = 'Green Park CHS';
select is(private.hook_before_user_created(pg_temp.event('invitee.a@society.test')) -> 'error' ->> 'http_code', '403',
  'an invite into a closed society does not allow signup');
update public.society set status = 'active' where name = 'Green Park CHS';

select ok(has_function_privilege('supabase_auth_admin', 'private.hook_before_user_created(jsonb)', 'execute'),
  'supabase_auth_admin can run the hook');
select ok(not has_function_privilege('authenticated', 'private.hook_before_user_created(jsonb)', 'execute'),
  'authenticated users cannot run the hook');

-- ---- auth.users triggers ------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000c1', 'authenticated',
        'authenticated', 'Invitee.A@Society.test', '{}', '{"full_name": "  Neha Patil "}', now(), now());
select is((select email from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  'invitee.a@society.test', 'a new auth user gets a profile with a lower-case email');
select is((select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  'Neha Patil', 'the profile takes the trimmed full_name from user metadata');
select ok(not exists (select 1 from public.platform_admin where user_id = '00000000-0000-4000-8000-0000000000c1'),
  'an ordinary new user is not a platform admin');

insert into private.platform_admin_email (email) values ('second.admin@society.test');
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000c2', 'authenticated',
        'authenticated', 'second.admin@society.test', '{}', '{}', now(), now());
select ok(exists (select 1 from public.platform_admin where user_id = '00000000-0000-4000-8000-0000000000c2'),
  'a bootstrap super-admin email becomes a platform admin on signup');

-- ---- email_hook_check (service role only) ----------------------------------------
select is(public.email_hook_check('stranger@gmail.com', 'magiclink') ->> 'reason', 'unknown_address',
  'the email hook refuses an unknown address');
update public.platform_config set email_per_address_hourly = 2;
select is(public.email_hook_check('member.a@society.test', 'magiclink') ->> 'allowed', 'true',
  'a known address within limits is allowed');
select public.email_hook_check('member.a@society.test', 'magiclink');
select is(public.email_hook_check('member.a@society.test', 'magiclink') ->> 'reason', 'address_hourly_limit',
  'the per-address hourly limit applies');
select ok(not has_function_privilege('authenticated', 'public.email_hook_check(text, text)', 'execute'),
  'signed-in users cannot call email_hook_check');

select * from finish();
rollback;
