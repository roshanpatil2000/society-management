-- Charge heads (what flats are billed for) and sequential document numbers per
-- society, document type and financial year.
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
select set_config('t.income', private.ledger_account_id(current_setting('t.a')::uuid, 'maintenance_income')::text, true);
select set_config('t.sinking', private.ledger_account_id(current_setting('t.a')::uuid, 'sinking_fund')::text, true);
select set_config('t.cash', private.ledger_account_id(current_setting('t.a')::uuid, 'cash')::text, true);
select set_config('t.b_income', private.ledger_account_id(current_setting('t.b')::uuid, 'maintenance_income')::text, true);
select set_config('t.b_flat', (select f.id::text from public.flat f where f.society_id = current_setting('t.b')::uuid limit 1), true);

create function pg_temp.head(p_name text, p_type text, p_cols text, p_vals text) returns text language sql as $$
  select format('insert into public.charge_head (society_id, name, calc_type, ledger_account_id%s) values (%L, %L, %L, %L%s)',
    p_cols, current_setting('t.a'), p_name, p_type, current_setting('t.income'), p_vals);
$$;

-- ---- charge heads ----------------------------------------------------------------------
select pg_temp.as_user('treasurer.a@society.test');
select lives_ok(pg_temp.head('Maintenance', 'per_sqft', ', rate_per_sqft', ', 3.5'),
  'the treasurer (charge_heads.manage) adds a per-sq-ft head');
select lives_ok(format('insert into public.charge_head (society_id, name, calc_type, ledger_account_id, rate_paise) values (%L, %L, %L, %L, 50000)',
  current_setting('t.a'), 'Sinking fund', 'flat', current_setting('t.sinking')), 'a flat-rate head can credit a fund');
select lives_ok(pg_temp.head('Parking', 'by_flat_type', ', rates_by_type', $$, '{"2BHK": 50000, "3BHK": 80000}'$$),
  'a head can charge by flat type');
select lives_ok(pg_temp.head('Painting levy', 'one_time', ', rate_paise', ', 300000'), 'a one-time head');
select throws_ok(pg_temp.head('No rate', 'per_sqft', '', ''), '23514', null, 'a per-sq-ft head needs its rate');
select throws_ok(pg_temp.head('Bad types', 'by_flat_type', ', rates_by_type', $$, '{"2BHK": -1}'$$),
  '23514', null, 'flat-type rates are whole, positive paise');
select throws_ok(pg_temp.head('Negative', 'flat', ', rate_paise', ', -100'), '23514', null, 'rates cannot be negative');
select throws_ok(pg_temp.head('Maintenance', 'flat', ', rate_paise', ', 100'), '23505', null, 'head names are unique in a society');
select throws_like(format('insert into public.charge_head (society_id, name, calc_type, ledger_account_id, rate_paise) values (%L, %L, %L, %L, 100)',
  current_setting('t.a'), 'To cash', 'flat', current_setting('t.cash')),
  'invalid_charge_head%', 'a head credits an income or fund account, not cash');
select throws_ok(format('insert into public.charge_head (society_id, name, calc_type, ledger_account_id, rate_paise) values (%L, %L, %L, %L, 100)',
  current_setting('t.a'), 'Cross', 'flat', current_setting('t.b_income')), '23503', null, 'a head cannot use another society''s account');
select throws_like(pg_temp.head('Spy flats', 'flat', ', rate_paise, flat_ids', format(', 100, array[%L]::uuid[]', current_setting('t.b_flat'))),
  'invalid_charge_head%', 'a head limited to some flats can name only this society''s flats');

reset role;
select pg_temp.as_user('member.a@society.test');
select is((select count(*)::int from public.charge_head where society_id = current_setting('t.a')::uuid), 4,
  'members can see what they are charged for');
select throws_ok(pg_temp.head('Rogue', 'flat', ', rate_paise', ', 1'), '42501', null, 'a member cannot add charge heads');
reset role;
select pg_temp.as_user('chair.b@society.test');
select is((select count(*)::int from public.charge_head where society_id = current_setting('t.a')::uuid), 0,
  'Society B sees no Society A charge heads');

-- ---- document numbers ------------------------------------------------------------------
reset role;
select is(array[private.next_doc_no(current_setting('t.a')::uuid, 'bill', date '2026-11-27'),
                private.next_doc_no(current_setting('t.a')::uuid, 'bill', date '2027-03-31'),
                private.next_doc_no(current_setting('t.a')::uuid, 'bill', date '2027-04-01'),
                private.next_doc_no(current_setting('t.a')::uuid, 'receipt', date '2026-11-27'),
                private.next_doc_no(current_setting('t.b')::uuid, 'bill', date '2026-11-27')],
  array['2026-27/000001', '2026-27/000002', '2027-28/000001', '2026-27/000001', '2026-27/000001'],
  'numbers run per society, document type and April-March financial year');
update public.society set financial_year_start_month = 1 where id = current_setting('t.b')::uuid;
select is(private.next_doc_no(current_setting('t.b')::uuid, 'receipt', date '2026-11-27'), '2026/000001',
  'a calendar-year society numbers by year');
select throws_ok($$select private.next_doc_no(null, 'bill', current_date)$$, '22023', null, 'a society is required');
select pg_temp.as_user('treasurer.a@society.test');
select throws_ok(format('select private.next_doc_no(%L, %L, current_date)', current_setting('t.a'), 'bill'),
  '42501', null, 'signed-in users cannot take document numbers directly');

select * from finish();
rollback;
