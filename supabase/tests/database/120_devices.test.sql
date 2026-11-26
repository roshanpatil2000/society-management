-- Devices: each person registers their own push token; nobody sees anyone else's.
-- A token re-registered by a different person (a handed-down phone) moves to them.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.as_user('member.a@society.test');
select lives_ok($$select public.register_device('ExponentPushToken[aaa]', 'ios')$$, 'a user can register a push token');
select lives_ok($$select public.register_device('ExponentPushToken[aaa]', 'ios')$$, 'registering the same token again is harmless');
select is((select count(*)::int from public.device), 1, 'the user sees their one device');
select throws_ok($$select public.register_device('not-a-token', 'ios')$$, '22023', null, 'a malformed token is refused');
select throws_ok($$select public.register_device('ExponentPushToken[bbb]', 'blackberry')$$, '22023', null,
  'an unknown platform is refused');
select throws_ok($$insert into public.device (user_id, expo_push_token, platform)
                   values (auth.uid(), 'ExponentPushToken[ccc]', 'ios')$$, '42501', null,
  'devices cannot be written directly');

reset role;
select pg_temp.as_user('chair.a@society.test');
select is((select count(*)::int from public.device), 0, 'another user cannot see someone else''s device');
select lives_ok($$select public.register_device('ExponentPushToken[aaa]', 'android')$$,
  'a phone passed to someone else can be registered by them');
reset role;
select is((select p.email from public.device d join public.profiles p on p.id = d.user_id
            where d.expo_push_token = 'ExponentPushToken[aaa]' and d.deleted_at is null),
  'chair.a@society.test', 'the token now belongs to the new person only');

select pg_temp.as_user('chair.a@society.test');
select public.unregister_device('ExponentPushToken[aaa]');
select is((select count(*)::int from public.device), 0, 'unregistering removes the device from the user''s list');

select * from finish();
rollback;
