-- Sensitive settings (UPI ID, payee, approval limit, interest, grace days, GST,
-- Razorpay, rounding) change only after a second person approves. Non-sensitive
-- settings change directly with society.update.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select set_config('t.a', (select id::text from public.society where name = 'Green Park CHS'), true);
select set_config('t.b', (select id::text from public.society where name = 'Blue Ridge CHS'), true);

-- ---- request ---------------------------------------------------------------------
select pg_temp.as_user('secretary.a@society.test');
select set_config('t.upi', public.request_setting_change(current_setting('t.a')::uuid, 'upi_id', '"greenpark.chs@okhdfc"')::text, true);
select is((select status from public.setting_change where id = current_setting('t.upi')::uuid), 'pending',
  'the secretary''s UPI ID change waits for approval');
select is((select settings ->> 'upi_id' from public.society where id = current_setting('t.a')::uuid), null,
  'the UPI ID is not changed by the request alone');
select throws_like(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.a'), 'upi_id', '"other@okicici"'),
  'already_pending%', 'only one pending change per setting');
select throws_ok(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.a'), 'upi_id', '"not a upi id"'),
  '22023', null, 'an invalid UPI ID is refused');
select throws_ok(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.a'), 'approval_limit', '"lots"'),
  '22023', null, 'approval_limit must be a whole number of paise');
select throws_ok(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.a'), 'interest_rate', '30'),
  '22023', null, 'interest above 21% a year is refused');
select throws_ok(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.a'), 'favourite_colour', '"blue"'),
  '22023', null, 'unknown setting keys are refused');
select throws_ok(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.b'), 'upi_id', '"x@okhdfc"'),
  '42501', null, 'the secretary of A cannot request changes in Society B');

reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(format('select public.request_setting_change(%L, %L, %L)', current_setting('t.a'), 'upi_id', '"x@okhdfc"'),
  '42501', null, 'a member cannot request a settings change');
select is((select count(*)::int from public.setting_change), 0, 'a member cannot see pending setting changes');

-- ---- approve / reject ------------------------------------------------------------------
reset role;
select pg_temp.as_user('secretary.a@society.test');
select throws_ok(format('select public.approve_setting_change(%L, %L)', current_setting('t.upi'), 'approve'),
  '42501', null, 'the secretary (no society.update_sensitive) cannot approve');

reset role;
select pg_temp.as_user('treasurer.a@society.test');
select throws_ok(format('select public.approve_setting_change(%L, %L)', current_setting('t.upi'), 'approve'),
  '42501', null, 'the treasurer cannot approve a sensitive change');

reset role;
select pg_temp.as_user('chair.a@society.test');
select lives_ok(format('select public.approve_setting_change(%L, %L, %L)', current_setting('t.upi'), 'approve', 'Checked with the bank'),
  'the chairman can approve the secretary''s change');
select is((select settings ->> 'upi_id' from public.society where id = current_setting('t.a')::uuid), 'greenpark.chs@okhdfc',
  'after approval the UPI ID is set');
select is((select status || ':' || (approved_by = (select id from public.profiles where email = 'chair.a@society.test'))::text
             from public.setting_change where id = current_setting('t.upi')::uuid),
  'approved:true', 'the change records who approved it');
select throws_like(format('select public.approve_setting_change(%L, %L)', current_setting('t.upi'), 'approve'),
  'not_pending%', 'a decided change cannot be decided again');

-- Maker-checker: the chairman cannot approve their own request.
select set_config('t.limit', public.request_setting_change(current_setting('t.a')::uuid, 'approval_limit', '500000')::text, true);
select throws_ok(format('select public.approve_setting_change(%L, %L)', current_setting('t.limit'), 'approve'),
  '42501', null, 'nobody can approve their own settings change');

-- Rejection leaves the setting alone.
reset role;
select pg_temp.as_user('secretary.a@society.test');
select set_config('t.payee', public.request_setting_change(current_setting('t.a')::uuid, 'payee_name', '"Green Park CHS Ltd"')::text, true);
reset role;
select pg_temp.as_user('chair.a@society.test');
select lives_ok(format('select public.approve_setting_change(%L, %L, %L)', current_setting('t.payee'), 'reject', 'Name must match the bank'),
  'the chairman can reject a change');
select is((select settings ->> 'payee_name' from public.society where id = current_setting('t.a')::uuid), null,
  'a rejected change is not applied');

-- ---- non-sensitive settings -----------------------------------------------------------
reset role;
select pg_temp.as_user('secretary.a@society.test');
select lives_ok(format('select public.update_society_settings(%L, %L)', current_setting('t.a'), '{"billing_cycle": "quarterly"}'),
  'the secretary can change the billing cycle directly');
select is((select settings ->> 'billing_cycle' from public.society where id = current_setting('t.a')::uuid), 'quarterly',
  'the billing cycle is updated');
select throws_ok(format('select public.update_society_settings(%L, %L)', current_setting('t.a'), '{"upi_id": "sneaky@okhdfc"}'),
  '42501', null, 'a sensitive setting cannot be changed through the direct path');
select throws_ok(format('update public.society set settings = %L where id = %L', '{"upi_id": "sneaky@okhdfc"}', current_setting('t.a')),
  '42501', null, 'society.settings cannot be written directly');

reset role;
select pg_temp.as_user('member.a@society.test');
select throws_ok(format('select public.update_society_settings(%L, %L)', current_setting('t.a'), '{"billing_cycle": "monthly"}'),
  '42501', null, 'a member cannot change settings');

select * from finish();
rollback;
