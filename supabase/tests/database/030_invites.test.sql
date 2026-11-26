-- Invites: create, resend, revoke, list and accept, with permissions, quotas and expiry.
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
create function pg_temp.new_user(p_email text) returns uuid language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          p_email, '{}', '{}', now(), now())
  returning id;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.member_role', (select id::text from public.role
  where society_id = current_setting('t.a')::uuid and name = 'Member'), true);
select set_config('t.chair_role', (select id::text from public.role
  where society_id = current_setting('t.a')::uuid and name = 'Chairman'), true);

-- An "Inviter" role: can invite, and holds the Member preset's keys but not the
-- Chairman's, given to a fresh user.
insert into public.role (society_id, name, permissions)
select current_setting('t.a')::uuid, 'Inviter', array['members.invite'] || p.permissions
from public.role_preset p where p.name = 'Member';
select pg_temp.new_user('inviter.a@society.test');
insert into public.membership (society_id, user_id)
select current_setting('t.a')::uuid, id from auth.users where email = 'inviter.a@society.test';
insert into public.membership_role (society_id, membership_id, role_id)
select m.society_id, m.id, r.id from public.membership m
join public.profiles p on p.id = m.user_id
join public.role r on r.society_id = m.society_id and r.name = 'Inviter'
where p.email = 'inviter.a@society.test';

-- ---- create_invite ----------------------------------------------------------
select pg_temp.as_user('chair.a@society.test');

select lives_ok(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[], %L)',
         current_setting('t.a'), ' New.Person@Society.test ', current_setting('t.member_role'), 'New Person'),
  'chairman can invite a new member');
select is((select email from public.invite where full_name = 'New Person'), 'new.person@society.test',
  'invite email is stored trimmed and lower-case');
select is((select invites_sent from public.society_usage where society_id = current_setting('t.a')::uuid), 1,
  'creating an invite counts in society_usage.invites_sent');

select throws_like(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'new.person@society.test', current_setting('t.member_role')),
  'already_invited%', 'a second pending invite to the same email is refused');
select throws_like(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'member.a@society.test', current_setting('t.member_role')),
  'already_member%', 'inviting an existing member is refused');
select throws_ok(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'not-an-email', current_setting('t.member_role')),
  '22023', null, 'an invalid email is refused');
select throws_ok(
  format('select * from public.create_invite(%L, %L, %L::uuid[])',
         current_setting('t.a'), 'noroles@society.test', '{}'),
  '42501', null, 'an invite with no roles is refused');
select throws_ok(
  format('select * from public.create_invite(%L, %L, array[(select id from public.role r2 where false)]::uuid[])',
         current_setting('t.a'), 'x@society.test'),
  '42501', null, 'an invite with an unknown role is refused');

-- Denied: a plain member has no members.invite.
reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'friend@society.test', current_setting('t.member_role')),
  '42501', null, 'a member without members.invite cannot invite');

-- Can't grant more than you hold: the Inviter may give Member, not Chairman.
reset role;
select pg_temp.as_user('inviter.a@society.test');
select lives_ok(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'ok.invitee@society.test', current_setting('t.member_role')),
  'an inviter can grant a role whose permissions they hold');
select throws_ok(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'chair.wannabe@society.test', current_setting('t.chair_role')),
  '42501', null, 'an inviter cannot grant a role with permissions they lack');

-- ---- quotas ------------------------------------------------------------------
reset role;
update public.society set quotas = quotas || '{"invites_per_day": 3}' where id = current_setting('t.a')::uuid;
select pg_temp.as_user('chair.a@society.test');
-- 2 sent today already (new.person, ok.invitee) + the seed invite from earlier today = 3.
select throws_like(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'over.daily@society.test', current_setting('t.member_role')),
  'quota_exceeded: invites_per_day%', 'invites_per_day quota is enforced');

reset role;
update public.society set quotas = quotas || '{"invites_per_day": 100, "max_members": 3}'
 where id = current_setting('t.a')::uuid;
select pg_temp.as_user('chair.a@society.test');
select throws_like(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'over.members@society.test', current_setting('t.member_role')),
  'quota_exceeded: max_members%', 'max_members quota counts members plus pending invites');

reset role;
update public.society set quotas = quotas || '{"max_members": 1000}' where id = current_setting('t.a')::uuid;

-- ---- resend / revoke -----------------------------------------------------------
select pg_temp.as_user('chair.a@society.test');
select set_config('t.old_token', (select token from public.invite where email = 'new.person@society.test'), true);
select lives_ok(
  format('select * from public.resend_invite((select id from public.invite where email = %L))', 'new.person@society.test'),
  'chairman can resend an invite');
select isnt((select token from public.invite where email = 'new.person@society.test'), current_setting('t.old_token'),
  'resending issues a new token');

select lives_ok(
  format('select public.revoke_invite((select id from public.invite where email = %L))', 'ok.invitee@society.test'),
  'chairman can revoke an invite');
select is((select status from public.invite where email = 'ok.invitee@society.test'), 'revoked',
  'revoked invite has status revoked');
select throws_like(
  format('select public.revoke_invite((select id from public.invite where email = %L))', 'ok.invitee@society.test'),
  'invite_not_pending%', 'revoking twice is refused');

-- ---- accept ------------------------------------------------------------------
reset role;
select pg_temp.new_user('new.person@society.test');
select pg_temp.new_user('stranger@society.test');
select set_config('t.token', (select token from public.invite where email = 'new.person@society.test'), true);

select pg_temp.as_user('stranger@society.test');
select is((select count(*)::int from public.my_pending_invites()), 0, 'a stranger has no pending invites');
select throws_ok(
  format('select public.accept_invite(%L)', current_setting('t.token')),
  '42501', null, 'someone else cannot accept an invite addressed to another email');

reset role;
select pg_temp.as_user('new.person@society.test');
select is((select society_name from public.my_pending_invites()), 'Green Park CHS', 'the invitee sees their invite');
select lives_ok(format('select public.accept_invite(%L)', current_setting('t.token')), 'the invitee can accept');
select is((select role_names from public.my_memberships), array['Member'], 'the invitee is now a Member of Society A');
select throws_like(format('select public.accept_invite(%L)', current_setting('t.token')),
  'invite_not_pending%', 'an accepted invite cannot be used again');

-- Expired invites cannot be accepted.
reset role;
update public.invite set expires_at = now() - interval '1 minute' where email = 'invitee.a@society.test';
select pg_temp.new_user('invitee.a@society.test');
select set_config('t.expired', (select token from public.invite where email = 'invitee.a@society.test'), true);
select pg_temp.as_user('invitee.a@society.test');
select throws_like(format('select public.accept_invite(%L)', current_setting('t.expired')),
  'invite_expired%', 'an expired invite cannot be accepted');

-- A suspended society takes no new invites.
reset role;
update public.society set status = 'suspended' where id = current_setting('t.a')::uuid;
select pg_temp.as_user('chair.a@society.test');
select throws_like(
  format('select * from public.create_invite(%L, %L, array[%L]::uuid[])',
         current_setting('t.a'), 'late@society.test', current_setting('t.member_role')),
  'society_inactive%', 'a suspended society cannot invite');

select * from finish();
rollback;
