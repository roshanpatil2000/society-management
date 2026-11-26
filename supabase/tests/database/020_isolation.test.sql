-- Tenant isolation: a Society A user sees nothing of Society B, and cannot act on it.
-- Uses the seed: Green Park CHS (A) and Blue Ridge CHS (B).
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.sid(p_name text) returns uuid language sql as $$
  select id from public.society where name = p_name;
$$;

-- Fixtures created as postgres: one invite and one usage row in each society.
select set_config('app.society_a', pg_temp.sid('Green Park CHS')::text, true);
select set_config('app.society_b', pg_temp.sid('Blue Ridge CHS')::text, true);
insert into public.invite (society_id, email, role_ids)
select current_setting('app.society_b')::uuid, 'someone.b@society.test', array[r.id]
from public.role r where r.society_id = current_setting('app.society_b')::uuid and r.name = 'Member';
select private.bump_usage(current_setting('app.society_b')::uuid, 'invites_sent', 1);

-- Chairman of A: has every society permission in A, none in B.
select pg_temp.as_user('chair.a@society.test');

select is((select count(*)::int from public.society where id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B row');
select is((select count(*)::int from public.membership where society_id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B memberships');
select is((select count(*)::int from public.role where society_id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B roles');
select is((select count(*)::int from public.membership_role where society_id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B role assignments');
select is((select count(*)::int from public.invite where society_id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B invites');
select is((select count(*)::int from public.society_usage where society_id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B usage');
select is((select count(*)::int from public.audit_log where society_id = current_setting('app.society_b')::uuid), 0,
  'chair A sees no Society B audit rows');
select is((select count(*)::int from public.profiles where email like '%.b@society.test'), 0,
  'chair A sees no Society B profiles');
select is((select count(*)::int from public.my_memberships where society_id = current_setting('app.society_b')::uuid), 0,
  'my_memberships shows no Society B membership for chair A');

-- Allowed side: chair A does see its own society's data.
select ok((select count(*) from public.membership where society_id = current_setting('app.society_a')::uuid) >= 2,
  'chair A sees Society A memberships');
select ok(exists (select 1 from public.profiles where email = 'member.a@society.test'),
  'chair A (members.view.all) sees Society A member profiles');
select ok((select count(*) from public.audit_log where society_id = current_setting('app.society_a')::uuid) > 0,
  'chair A (audit_log.view) sees Society A audit rows');

-- RPCs with Society B's id.
select throws_ok(
  format('select public.get_my_permissions(%L)', current_setting('app.society_b')),
  '42501', null, 'get_my_permissions for Society B is refused');
select throws_ok(
  format('select * from public.create_invite(%L, %L, array[(select id from public.role limit 1)])',
         current_setting('app.society_b'), 'x@society.test'),
  '42501', null, 'create_invite into Society B is refused');
select throws_ok(
  format('select public.revoke_invite((select id from public.invite where email = %L))', 'someone.b@society.test'),
  '42501', null, 'revoke_invite of a Society B invite is refused (chair A cannot even see it)');

-- A plain member of A.
reset role;
select pg_temp.as_user('member.a@society.test');
select is((select count(*)::int from public.society), 1, 'member A sees only Society A');
select is((select count(*)::int from public.membership), 1, 'member A sees only their own membership');
select is((select count(*)::int from public.profiles), 1, 'member A sees only their own profile');
select is((select count(*)::int from public.invite), 0, 'member A (no members.invite) sees no invites');
select is((select count(*)::int from public.audit_log), 0, 'member A (no audit_log.view) sees no audit rows');
select is(public.get_my_permissions(current_setting('app.society_a')::uuid), array['society.view'],
  'member A has only society.view in Society A');

-- Someone with no membership anywhere.
reset role;
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000dead', 'authenticated',
        'authenticated', 'nobody@society.test', '{}', '{}', now(), now());
select pg_temp.as_user('nobody@society.test');
select is((select count(*)::int from public.society) + (select count(*)::int from public.membership)
          + (select count(*)::int from public.role), 0,
  'a user with no membership sees no societies, memberships or roles');

select * from finish();
rollback;
