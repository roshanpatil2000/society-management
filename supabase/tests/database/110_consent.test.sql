-- Consent notice (DPDP Act): each person accepts the current notice version once;
-- the acceptance is theirs alone to record.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Start from a known state, whatever manual testing did to the local database.
update public.profiles set consent_version = null, consent_accepted_at = null where email = 'member.a@society.test';
select is((select consent_version::int from public.profiles where email = 'member.a@society.test'), null,
  'nobody has accepted the notice yet');

select pg_temp.as_user('member.a@society.test');
select lives_ok('select public.accept_consent(1)', 'a user can accept the consent notice');
select is((select consent_version::int from public.profiles where email = 'member.a@society.test'), 1,
  'the accepted version is recorded');
select ok((select consent_accepted_at > now() - interval '1 minute' from public.profiles where email = 'member.a@society.test'),
  'the acceptance time is recorded');
select throws_ok('select public.accept_consent(0)', '22023', null, 'a version below 1 is refused');
select throws_ok('update public.profiles set consent_version = 5 where email = ''member.a@society.test''',
  '42501', null, 'consent cannot be written directly, only through accept_consent');

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok('select public.accept_consent(1)', '42501', null, 'signed-out callers cannot record consent');

select * from finish();
rollback;
