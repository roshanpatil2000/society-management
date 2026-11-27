-- Flat transfers: one committee member requests, another approves (maker-checker).
-- Approval closes the sellers' occupancy, adds buyers who are already members,
-- invites the rest, and removes memberships left with no flat and no committee
-- role. A nightly job does the same cleanup when occupancies end.
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
create temp table t_uid as select email, id from auth.users;
grant select on t_uid to authenticated;
create function pg_temp.uid(p_email text) returns uuid language sql as $$
  select id from t_uid where email = p_email;
$$;
create function pg_temp.flat(p_wing text, p_number text) returns uuid language sql as $$
  select f.id from public.flat f join public.wing w on w.id = f.wing_id
  where w.name = p_wing and f.number = p_number and f.deleted_at is null;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);
select set_config('t.today', private.today_ist()::text, true);
-- Occupants moved in a year ago, so a transfer today can close them.
update public.flat_occupant set from_date = private.today_ist() - 365;
select set_config('t.ravi_occ', (select id::text from public.flat_occupant
  where flat_id = pg_temp.flat('A', '101') and user_id = pg_temp.uid('member.a@society.test')), true);
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

create function pg_temp.request(p_flat uuid, p_from uuid[], p_buyers text) returns uuid language sql as $$
  select public.request_flat_transfer(current_setting('t.a')::uuid, p_flat, p_from, p_buyers::jsonb,
    current_setting('t.today')::date, 'GP-SC-0101-B', 2500000, 'Sale deed registered');
$$;

-- ---- requesting ---------------------------------------------------------------------
select pg_temp.as_user('secretary.a@society.test');
insert into t_ids values ('tr', pg_temp.request(pg_temp.flat('A', '101'), array[current_setting('t.ravi_occ')::uuid],
  '[{"email": "chair.a@society.test", "type": "owner"},
    {"email": "New.Buyer@society.test", "full_name": "Meera Iyer", "type": "joint_owner"}]'));
select is((select status from public.flat_transfer where id = (select v from t_ids where k = 'tr')), 'requested',
  'the secretary (members.manage) can request a transfer');
select throws_like(format('select pg_temp.request(%L, array[]::uuid[], %L)', pg_temp.flat('A', '101'),
  '[{"email": "x@society.test", "type": "owner"}]'),
  'transfer_pending%', 'a flat has only one open transfer at a time');
select throws_like(format('select pg_temp.request(%L, array[%L]::uuid[], %L)', pg_temp.flat('A', '201'),
  current_setting('t.ravi_occ'), '[{"email": "x@society.test", "type": "owner"}]'),
  'invalid_transfer%', 'sellers must be current owners of that flat');
select throws_like(format('select pg_temp.request(%L, array[]::uuid[], %L)', pg_temp.flat('A', '201'),
  '[{"email": "x@society.test", "type": "tenant"}]'),
  'invalid_transfer%', 'buyers are owners or joint owners');
reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(format('select pg_temp.request(%L, array[]::uuid[], %L)', pg_temp.flat('A', '201'),
  '[{"email": "x@society.test", "type": "owner"}]'), '42501', null, 'a member cannot request a transfer');
reset role;
select pg_temp.as_user('chair.b@society.test');
select throws_ok(format('select pg_temp.request(%L, array[]::uuid[], %L)', pg_temp.flat('A', '201'),
  '[{"email": "x@society.test", "type": "owner"}]'), '42501', null, 'Society B cannot request transfers in Society A');
select is((select count(*)::int from public.flat_transfer where society_id = current_setting('t.a')::uuid), 0,
  'Society B sees no Society A transfers');

-- ---- approving ------------------------------------------------------------------------
reset role;
select pg_temp.as_user('secretary.a@society.test');
select throws_like(format('select public.approve_flat_transfer(%L, %L)', (select v from t_ids where k = 'tr'), 'approve'),
  'maker_checker%', 'whoever requested a transfer cannot approve it');
reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(format('select public.approve_flat_transfer(%L, %L)', (select v from t_ids where k = 'tr'), 'approve'),
  '42501', null, 'a member cannot approve a transfer');
select is((select count(*)::int from public.flat_transfer), 0, 'members do not see transfers');

reset role;
select pg_temp.as_user('chair.a@society.test');
select is(public.approve_flat_transfer((select v from t_ids where k = 'tr'), 'approve'),
  '{"closed": 1, "added": 1, "invited": 1, "memberships_removed": 1}'::jsonb,
  'the chairman (members.transfer) approves: one seller out, one member added, one buyer invited');
reset role;
select is((select to_date from public.flat_occupant where id = current_setting('t.ravi_occ')::uuid),
  current_setting('t.today')::date - 1, 'the seller''s occupancy ends the day before the transfer');
select is((select status from public.membership where society_id = current_setting('t.a')::uuid
            and user_id = pg_temp.uid('member.a@society.test')), 'removed',
  'a seller left with no flat and no committee role is no longer a member');
select is((select type || ' from ' || from_date from public.flat_occupant
            where flat_id = pg_temp.flat('A', '101') and user_id = pg_temp.uid('chair.a@society.test') and to_date is null),
  'owner from ' || current_setting('t.today'), 'a buyer who is already a member becomes owner from the transfer date');
select is((select i.occupant_type || ' ' || (i.flat_id = pg_temp.flat('A', '101'))::text || ' ' || r.name
             from public.invite i join public.role r on r.id = i.role_ids[1]
            where i.email = 'new.buyer@society.test' and i.status = 'pending'),
  'joint_owner true Member', 'a new buyer gets a Member invite for the flat');
select is((select status || ' ' || share_cert_no || ' ' || transfer_fee from public.flat_transfer where id = (select v from t_ids where k = 'tr')),
  'approved GP-SC-0101-B 2500000', 'the transfer records the share certificate and fee');
select pg_temp.as_user('chair.a@society.test');
select throws_like(format('select public.approve_flat_transfer(%L, %L)', (select v from t_ids where k = 'tr'), 'approve'),
  'transfer_not_pending%', 'a decided transfer cannot be decided again');

-- ---- rejecting ------------------------------------------------------------------------
reset role;
select pg_temp.as_user('secretary.a@society.test');
insert into t_ids values ('tr2', pg_temp.request(pg_temp.flat('B', '101'), array[]::uuid[],
  '[{"email": "builder.buyer@society.test", "type": "owner"}]'));
reset role;
select pg_temp.as_user('chair.a@society.test');
select public.approve_flat_transfer((select v from t_ids where k = 'tr2'), 'reject', 'Documents incomplete');
reset role;
select is((select status || ': ' || reject_reason from public.flat_transfer where id = (select v from t_ids where k = 'tr2'))
          || ' / invites ' || (select count(*) from public.invite where email = 'builder.buyer@society.test'),
  'rejected: Documents incomplete / invites 0', 'a rejected transfer changes nothing');

-- ---- nightly expiry --------------------------------------------------------------------
-- chair.a's new A-101 ownership is set aside so they are left with no flat at all.
update public.flat_occupant set deleted_at = now()
 where user_id = pg_temp.uid('chair.a@society.test') and from_date = current_setting('t.today')::date;
update public.flat_occupant set to_date = current_setting('t.today')::date - 1
 where deleted_at is null and user_id in (pg_temp.uid('tenant.a@society.test'), pg_temp.uid('chair.a@society.test'));
select private.run_occupancy_expiry();
select is((select status from public.membership where society_id = current_setting('t.a')::uuid
            and user_id = pg_temp.uid('tenant.a@society.test')), 'removed',
  'when a tenancy ends, a tenant with nothing else is no longer a member');
select is((select status from public.membership where society_id = current_setting('t.a')::uuid
            and user_id = pg_temp.uid('chair.a@society.test')), 'active',
  'a committee member keeps their membership without a flat');
select is((select status from public.job_run where job = 'occupancy_expiry' order by id desc limit 1), 'succeeded',
  'the job logs each run');
select is((select count(*)::int from cron.job where jobname = 'occupancy-expiry'), 1,
  'the expiry job is scheduled nightly');

select * from finish();
rollback;
