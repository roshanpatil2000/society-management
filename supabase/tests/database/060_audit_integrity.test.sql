-- Audit log, immutability guard, composite foreign keys, role permission checks
-- and column-level write limits.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);

-- ---- audit_log -------------------------------------------------------------------
select pg_temp.as_user('chair.a@society.test');
update public.society set name = 'Green Park CHS (audited)' where id = current_setting('t.a')::uuid;
reset role;
select is(
  (select actor_id::text || '|' || (before ->> 'name') || '|' || (after ->> 'name')
     from public.audit_log
    where table_name = 'society' and action = 'UPDATE' and row_id = current_setting('t.a')
    order by id desc limit 1),
  (select id::text from auth.users where email = 'chair.a@society.test') || '|Green Park CHS|Green Park CHS (audited)',
  'an update is audited with the user as actor and before/after values');

-- A cron job or webhook runs with no user claims at all.
select set_config('request.jwt.claims', '', true);
select set_config('app.actor', 'system:test_job', true);
update public.society set address = 'Changed by a job' where id = current_setting('t.a')::uuid;
select is(
  (select actor_label from public.audit_log where table_name = 'society' order by id desc limit 1),
  'system:test_job', 'a system change is audited with the app.actor label');

select pg_temp.as_user('chair.a@society.test');
select throws_ok('insert into public.audit_log (actor_label, action, table_name) values (''x'', ''INSERT'', ''x'')',
  '42501', null, 'signed-in users cannot insert audit rows');
select throws_ok('update public.audit_log set actor_label = ''forged''',
  '42501', null, 'signed-in users cannot update audit rows');
select throws_ok('delete from public.audit_log',
  '42501', null, 'signed-in users cannot delete audit rows');
reset role;
set local role service_role;
select throws_ok('update public.audit_log set actor_label = ''forged''',
  '42501', null, 'even the service role cannot update audit rows');
select throws_ok('delete from public.audit_log',
  '42501', null, 'even the service role cannot delete audit rows');
reset role;

-- ---- no direct writes to access tables --------------------------------------------
select pg_temp.as_user('chair.a@society.test');
select throws_ok(format('insert into public.membership (society_id, user_id) values (%L, %L)',
  current_setting('t.a'), (select id from public.profiles where email = 'chair.a@society.test')),
  '42501', null, 'memberships cannot be written directly, only through RPCs');
select throws_ok(format('update public.role set permissions = %L where society_id = %L', '{audit_log.view}', current_setting('t.a')),
  '42501', null, 'roles cannot be edited directly, only through RPCs');
select throws_ok('delete from public.invite', '42501', null, 'invites cannot be hard-deleted');
reset role;

-- ---- composite foreign keys ----------------------------------------------------------
select throws_ok(
  format('insert into public.membership_role (society_id, membership_id, role_id)
          select %L, m.id, r.id from public.membership m, public.role r
           where m.society_id = %L and r.society_id = %L limit 1',
         current_setting('t.a'), current_setting('t.a'), current_setting('t.b')),
  '23503', null, 'a Society A membership cannot be given a Society B role');

-- ---- role permission validation ------------------------------------------------------
select throws_ok(
  format('insert into public.role (society_id, name, permissions) values (%L, %L, %L)',
         current_setting('t.a'), 'Fake', '{made.up}'),
  '22023', null, 'a role cannot carry an unknown permission');
select throws_ok(
  format('insert into public.role (society_id, name, permissions) values (%L, %L, %L)',
         current_setting('t.a'), 'Sneaky', '{platform.societies.create}'),
  '22023', null, 'a society role can never carry a platform permission');

-- ---- profiles: own row, limited columns ------------------------------------------------
select pg_temp.as_user('member.a@society.test');
select lives_ok('update public.profiles set phone = ''+919876543210'' where email = ''member.a@society.test''',
  'a user can update their own phone number');
select throws_ok('update public.profiles set email = ''someone@else.com'' where email = ''member.a@society.test''',
  '42501', null, 'a user cannot change their profile email directly');
update public.profiles set full_name = 'Hijacked' where email = 'chair.a@society.test';
reset role;
select is((select full_name from public.profiles where email = 'chair.a@society.test'), 'Asha Kulkarni',
  'a user cannot update someone else''s profile');

-- ---- guard_immutable ------------------------------------------------------------------
create temp table locked_doc (id int primary key, status text, amount int, note text, updated_at timestamptz);
create trigger locked_doc_guard before update or delete on locked_doc
  for each row execute function private.guard_immutable('status', 'approved', 'status', 'note');
insert into locked_doc values (1, 'approved', 100, 'x', now());
select throws_like('update locked_doc set amount = 200 where id = 1',
  'immutable_row: column amount%', 'a locked row''s amount cannot change');
select lives_ok('update locked_doc set note = ''fine'', status = ''approved'' where id = 1',
  'whitelisted columns on a locked row can still change');

select * from finish();
rollback;
